#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <utf.h>
#include <uv.h>

typedef utf8_t bare_dgram_address_t[INET6_ADDRSTRLEN + 1 /* '%' */ + UV_IF_NAMESIZE + 1 /* NULL */];

typedef struct {
  uv_udp_t handle;

  uv_buf_t read;

  js_env_t *env;
  js_ref_t *ctx;
  js_ref_t *on_message;
  js_ref_t *on_send;
  js_ref_t *on_close;

  bool closing;
  bool exiting;

  js_deferred_teardown_t *teardown;
} bare_dgram_t;

typedef struct {
  uv_udp_send_t handle;

  bare_dgram_t *dgram;

  uint32_t id;
} bare_dgram_send_t;

static inline int
bare_dgram__get_address(js_env_t *env, js_value_t *value, utf8_t *str, size_t len) {
  int err;

  size_t written;
  err = js_get_value_string_utf8(env, value, str, len, &written);
  assert(err == 0);

  if (written == len) {
    err = js_throw_error(env, uv_err_name(UV_ENAMETOOLONG), uv_strerror(UV_ENAMETOOLONG));
    assert(err == 0);

    return -1;
  }

  return 0;
}

static inline int
bare_dgram__to_sockaddr(const utf8_t *ip, uint32_t port, uint32_t family, struct sockaddr_storage *result) {
  if (family == 6) {
    return uv_ip6_addr((char *) ip, (int) port, (struct sockaddr_in6 *) result);
  }

  return uv_ip4_addr((char *) ip, (int) port, (struct sockaddr_in *) result);
}

static inline void
bare_dgram__from_sockaddr(const struct sockaddr *addr, bare_dgram_address_t ip, uint32_t *port, uint32_t *family) {
  int err;

  if (addr->sa_family == AF_INET) {
    const struct sockaddr_in *in = (const struct sockaddr_in *) addr;

    err = uv_inet_ntop(AF_INET, &in->sin_addr, (char *) ip, INET6_ADDRSTRLEN);
    assert(err == 0);

    *port = ntohs(in->sin_port);
    *family = 4;
  } else if (addr->sa_family == AF_INET6) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *) addr;

    err = uv_inet_ntop(AF_INET6, &in6->sin6_addr, (char *) ip, INET6_ADDRSTRLEN);
    assert(err == 0);

    *port = ntohs(in6->sin6_port);
    *family = 6;
  } else {
    ip[0] = '\0';

    *port = 0;
    *family = 0;
  }
}

static inline int
bare_dgram__buffers(js_env_t *env, js_value_t *value, uv_buf_t **result, uint32_t *len) {
  int err;

  uint32_t bufs_len;
  err = js_get_array_length(env, value, &bufs_len);
  assert(err == 0);

  uv_buf_t *bufs = malloc(sizeof(uv_buf_t) * bufs_len);

  js_value_t **elements = malloc(sizeof(js_value_t *) * bufs_len);

  if ((bufs == NULL || elements == NULL) && bufs_len > 0) {
    free(bufs);
    free(elements);

    err = js_throw_error(env, uv_err_name(UV_ENOMEM), uv_strerror(UV_ENOMEM));
    assert(err == 0);

    return -1;
  }

  err = js_get_array_elements(env, value, elements, bufs_len, 0, NULL);
  assert(err == 0);

  for (uint32_t i = 0; i < bufs_len; i++) {
    uv_buf_t *buf = &bufs[i];

    size_t buf_len;
    err = js_get_typedarray_info(env, elements[i], NULL, (void **) &buf->base, &buf_len, NULL, NULL);
    assert(err == 0);

    buf->len = buf_len;
  }

  free(elements);

  *result = bufs;
  *len = bufs_len;

  return 0;
}

static void
bare_dgram__on_message(uv_udp_t *handle, ssize_t nread, const uv_buf_t *buf, const struct sockaddr *addr, unsigned flags) {
  int err;

  if (nread == 0 && addr == NULL) return;

  bare_dgram_t *dgram = (bare_dgram_t *) handle;

  if (dgram->closing || dgram->exiting) return;

  // The datagram didn't fit in the read buffer and was truncated, so surface it
  // as an error rather than silently dropping the remainder.
  if (flags & UV_UDP_PARTIAL) nread = UV_EMSGSIZE;

  js_env_t *env = dgram->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, dgram->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_message;
  err = js_get_reference_value(env, dgram->on_message, &on_message);
  assert(err == 0);

  js_value_t *argv[5];

  if (nread < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name((int) nread), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror((int) nread), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, 0, &argv[1]);
    assert(err == 0);

    err = js_create_uint32(env, 0, &argv[2]);
    assert(err == 0);

    err = js_get_null(env, &argv[3]);
    assert(err == 0);

    err = js_create_uint32(env, 0, &argv[4]);
    assert(err == 0);
  } else {
    bare_dgram_address_t ip;
    uint32_t port;
    uint32_t family;

    bare_dgram__from_sockaddr(addr, ip, &port, &family);

    err = js_get_null(env, &argv[0]);
    assert(err == 0);

    err = js_create_int32(env, (int32_t) nread, &argv[1]);
    assert(err == 0);

    err = js_create_uint32(env, port, &argv[2]);
    assert(err == 0);

    err = js_create_string_utf8(env, ip, -1, &argv[3]);
    assert(err == 0);

    err = js_create_uint32(env, family, &argv[4]);
    assert(err == 0);
  }

  js_call_function(env, ctx, on_message, 5, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_dgram__on_send(uv_udp_send_t *handle, int status) {
  int err;

  bare_dgram_send_t *req = (bare_dgram_send_t *) handle;

  bare_dgram_t *dgram = req->dgram;

  uint32_t id = req->id;

  free(req);

  if (dgram->exiting) return;

  js_env_t *env = dgram->env;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, dgram->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_send;
  err = js_get_reference_value(env, dgram->on_send, &on_send);
  assert(err == 0);

  js_value_t *argv[2];

  if (status < 0) {
    js_value_t *code;
    err = js_create_string_utf8(env, (utf8_t *) uv_err_name(status), -1, &code);
    assert(err == 0);

    js_value_t *message;
    err = js_create_string_utf8(env, (utf8_t *) uv_strerror(status), -1, &message);
    assert(err == 0);

    err = js_create_error(env, code, message, &argv[0]);
    assert(err == 0);
  } else {
    err = js_get_null(env, &argv[0]);
    assert(err == 0);
  }

  err = js_create_uint32(env, id, &argv[1]);
  assert(err == 0);

  js_call_function(env, ctx, on_send, 2, argv, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);
}

static void
bare_dgram__on_close(uv_handle_t *handle) {
  int err;

  bare_dgram_t *dgram = (bare_dgram_t *) handle;

  js_env_t *env = dgram->env;

  js_deferred_teardown_t *teardown = dgram->teardown;

  js_handle_scope_t *scope;
  err = js_open_handle_scope(env, &scope);
  assert(err == 0);

  js_value_t *ctx;
  err = js_get_reference_value(env, dgram->ctx, &ctx);
  assert(err == 0);

  js_value_t *on_close;
  err = js_get_reference_value(env, dgram->on_close, &on_close);
  assert(err == 0);

  err = js_delete_reference(env, dgram->on_message);
  assert(err == 0);

  err = js_delete_reference(env, dgram->on_send);
  assert(err == 0);

  err = js_delete_reference(env, dgram->on_close);
  assert(err == 0);

  err = js_delete_reference(env, dgram->ctx);
  assert(err == 0);

  if (!dgram->exiting) js_call_function(env, ctx, on_close, 0, NULL, NULL);

  err = js_close_handle_scope(env, scope);
  assert(err == 0);

  err = js_finish_deferred_teardown_callback(teardown);
  assert(err == 0);
}

static void
bare_dgram__on_teardown(js_deferred_teardown_t *handle, void *data) {
  bare_dgram_t *dgram = (bare_dgram_t *) data;

  dgram->exiting = true;

  if (dgram->closing) return;

  uv_close((uv_handle_t *) &dgram->handle, bare_dgram__on_close);
}

static void
bare_dgram__on_alloc(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
  bare_dgram_t *dgram = (bare_dgram_t *) handle;

  *buf = dgram->read;
}

static js_value_t *
bare_dgram_init(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 6;
  js_value_t *argv[6];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 6);

  uv_loop_t *loop;
  err = js_get_env_loop(env, &loop);
  assert(err == 0);

  js_value_t *handle;

  bare_dgram_t *dgram;
  err = js_create_arraybuffer(env, sizeof(bare_dgram_t), (void **) &dgram, &handle);
  assert(err == 0);

  uint32_t family;
  err = js_get_value_uint32(env, argv[1], &family);
  assert(err == 0);

  unsigned int domain = AF_UNSPEC;

  if (family == 4) domain = AF_INET;
  else if (family == 6) domain = AF_INET6;

  err = uv_udp_init_ex(loop, &dgram->handle, domain);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  dgram->env = env;
  dgram->closing = false;
  dgram->exiting = false;

  size_t read_len;
  err = js_get_typedarray_info(env, argv[0], NULL, (void **) &dgram->read.base, &read_len, NULL, NULL);
  assert(err == 0);

  dgram->read.len = read_len;

  err = js_create_reference(env, argv[2], 1, &dgram->ctx);
  assert(err == 0);

  err = js_create_reference(env, argv[3], 1, &dgram->on_message);
  assert(err == 0);

  err = js_create_reference(env, argv[4], 1, &dgram->on_send);
  assert(err == 0);

  err = js_create_reference(env, argv[5], 1, &dgram->on_close);
  assert(err == 0);

  err = js_add_deferred_teardown_callback(env, bare_dgram__on_teardown, (void *) dgram, &dgram->teardown);
  assert(err == 0);

  return handle;
}

static js_value_t *
bare_dgram_connect(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 4;
  js_value_t *argv[4];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 4);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uint32_t port;
  err = js_get_value_uint32(env, argv[1], &port);
  assert(err == 0);

  bare_dgram_address_t ip;
  if (bare_dgram__get_address(env, argv[2], ip, sizeof(ip)) < 0) return NULL;

  uint32_t family;
  err = js_get_value_uint32(env, argv[3], &family);
  assert(err == 0);

  struct sockaddr_storage addr;

  err = bare_dgram__to_sockaddr(ip, port, family, &addr);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  err = uv_udp_connect(&dgram->handle, (struct sockaddr *) &addr);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_disconnect(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  err = uv_udp_connect(&dgram->handle, NULL);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_bind(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 5;
  js_value_t *argv[5];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 5);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uint32_t port;
  err = js_get_value_uint32(env, argv[1], &port);
  assert(err == 0);

  bare_dgram_address_t ip;
  if (bare_dgram__get_address(env, argv[2], ip, sizeof(ip)) < 0) return NULL;

  uint32_t family;
  err = js_get_value_uint32(env, argv[3], &family);
  assert(err == 0);

  uint32_t flags;
  err = js_get_value_uint32(env, argv[4], &flags);
  assert(err == 0);

  struct sockaddr_storage addr;

  err = bare_dgram__to_sockaddr(ip, port, family, &addr);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  err = uv_udp_bind(&dgram->handle, (struct sockaddr *) &addr, flags);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_open(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  int32_t fd;
  err = js_get_value_int32(env, argv[1], &fd);
  assert(err == 0);

  uv_os_sock_t sock = (uv_os_sock_t) uv_get_osfhandle(fd);

  err = uv_udp_open(&dgram->handle, sock);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_resume(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  err = uv_udp_recv_start(&dgram->handle, bare_dgram__on_alloc, bare_dgram__on_message);

  if (err < 0 && err != UV_EALREADY) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_pause(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  err = uv_udp_recv_stop(&dgram->handle);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_send(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 6;
  js_value_t *argv[6];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 6);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uint32_t id;
  err = js_get_value_uint32(env, argv[1], &id);
  assert(err == 0);

  // A connected socket sends to its peer and must not be given an address.
  js_value_type_t address_type;
  err = js_typeof(env, argv[4], &address_type);
  assert(err == 0);

  bool connected = address_type == js_null || address_type == js_undefined;

  struct sockaddr_storage addr;

  if (!connected) {
    uint32_t port;
    err = js_get_value_uint32(env, argv[3], &port);
    assert(err == 0);

    bare_dgram_address_t ip;
    if (bare_dgram__get_address(env, argv[4], ip, sizeof(ip)) < 0) return NULL;

    uint32_t family;
    err = js_get_value_uint32(env, argv[5], &family);
    assert(err == 0);

    err = bare_dgram__to_sockaddr(ip, port, family, &addr);

    if (err < 0) {
      err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
      assert(err == 0);

      return NULL;
    }
  }

  uv_buf_t *bufs;
  uint32_t bufs_len;
  if (bare_dgram__buffers(env, argv[2], &bufs, &bufs_len) < 0) return NULL;

  bare_dgram_send_t *req = malloc(sizeof(bare_dgram_send_t));

  if (req == NULL) {
    free(bufs);

    err = js_throw_error(env, uv_err_name(UV_ENOMEM), uv_strerror(UV_ENOMEM));
    assert(err == 0);

    return NULL;
  }

  req->dgram = dgram;
  req->id = id;

  err = uv_udp_send(&req->handle, &dgram->handle, bufs, bufs_len, connected ? NULL : (struct sockaddr *) &addr, bare_dgram__on_send);

  free(bufs);

  if (err < 0) {
    free(req);

    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_close(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  if (dgram->closing) return NULL;

  dgram->closing = true;

  uv_close((uv_handle_t *) &dgram->handle, bare_dgram__on_close);

  return NULL;
}

static js_value_t *
bare_dgram_address(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bool local;
  err = js_get_value_bool(env, argv[1], &local);
  assert(err == 0);

  struct sockaddr_storage addr;
  int len = sizeof(addr);

  if (local) {
    err = uv_udp_getsockname(&dgram->handle, (struct sockaddr *) &addr, &len);
  } else {
    err = uv_udp_getpeername(&dgram->handle, (struct sockaddr *) &addr, &len);
  }

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  bare_dgram_address_t ip;
  uint32_t port;
  uint32_t family;

  bare_dgram__from_sockaddr((struct sockaddr *) &addr, ip, &port, &family);

  if (family == 0) {
    err = js_throw_error(env, uv_err_name(UV_EAI_ADDRFAMILY), uv_strerror(UV_EAI_ADDRFAMILY));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_object(env, &result);
  assert(err == 0);

  js_value_t *result_address;
  err = js_create_string_utf8(env, ip, -1, &result_address);
  assert(err == 0);

  js_value_t *result_family;
  err = js_create_uint32(env, family, &result_family);
  assert(err == 0);

  js_value_t *result_port;
  err = js_create_uint32(env, port, &result_port);
  assert(err == 0);

  err = js_set_named_property(env, result, "address", result_address);
  assert(err == 0);

  err = js_set_named_property(env, result, "family", result_family);
  assert(err == 0);

  err = js_set_named_property(env, result, "port", result_port);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_dgram_set_broadcast(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bool enable;
  err = js_get_value_bool(env, argv[1], &enable);
  assert(err == 0);

  err = uv_udp_set_broadcast(&dgram->handle, enable);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_ttl(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uint32_t ttl;
  err = js_get_value_uint32(env, argv[1], &ttl);
  assert(err == 0);

  err = uv_udp_set_ttl(&dgram->handle, (int) ttl);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_multicast_ttl(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uint32_t ttl;
  err = js_get_value_uint32(env, argv[1], &ttl);
  assert(err == 0);

  err = uv_udp_set_multicast_ttl(&dgram->handle, (int) ttl);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_multicast_loopback(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bool enable;
  err = js_get_value_bool(env, argv[1], &enable);
  assert(err == 0);

  err = uv_udp_set_multicast_loop(&dgram->handle, enable);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_multicast_interface(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bare_dgram_address_t iface;
  if (bare_dgram__get_address(env, argv[1], iface, sizeof(iface)) < 0) return NULL;

  err = uv_udp_set_multicast_interface(&dgram->handle, (char *) iface);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_membership(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 4;
  js_value_t *argv[4];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 4);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bare_dgram_address_t group;
  if (bare_dgram__get_address(env, argv[1], group, sizeof(group)) < 0) return NULL;

  bare_dgram_address_t iface;

  js_value_type_t iface_type;
  err = js_typeof(env, argv[2], &iface_type);
  assert(err == 0);

  if (iface_type == js_null || iface_type == js_undefined) {
    iface[0] = '\0';
  } else if (bare_dgram__get_address(env, argv[2], iface, sizeof(iface)) < 0) {
    return NULL;
  }

  bool join;
  err = js_get_value_bool(env, argv[3], &join);
  assert(err == 0);

  err = uv_udp_set_membership(&dgram->handle, (char *) group, iface[0] == '\0' ? NULL : (char *) iface, join ? UV_JOIN_GROUP : UV_LEAVE_GROUP);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_set_source_membership(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 5;
  js_value_t *argv[5];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 5);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  bare_dgram_address_t group;
  if (bare_dgram__get_address(env, argv[1], group, sizeof(group)) < 0) return NULL;

  bare_dgram_address_t source;
  if (bare_dgram__get_address(env, argv[2], source, sizeof(source)) < 0) return NULL;

  bare_dgram_address_t iface;

  js_value_type_t iface_type;
  err = js_typeof(env, argv[3], &iface_type);
  assert(err == 0);

  if (iface_type == js_null || iface_type == js_undefined) {
    iface[0] = '\0';
  } else if (bare_dgram__get_address(env, argv[3], iface, sizeof(iface)) < 0) {
    return NULL;
  }

  bool join;
  err = js_get_value_bool(env, argv[4], &join);
  assert(err == 0);

  err = uv_udp_set_source_membership(&dgram->handle, (char *) group, iface[0] == '\0' ? NULL : (char *) iface, (char *) source, join ? UV_JOIN_GROUP : UV_LEAVE_GROUP);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_dgram_send_buffer_size(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  // A size of `0` reads the current size, anything else sets it.
  int32_t size;
  err = js_get_value_int32(env, argv[1], &size);
  assert(err == 0);

  err = uv_send_buffer_size((uv_handle_t *) &dgram->handle, &size);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_int32(env, size, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_dgram_recv_buffer_size(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 2;
  js_value_t *argv[2];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 2);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  // A size of `0` reads the current size, anything else sets it.
  int32_t size;
  err = js_get_value_int32(env, argv[1], &size);
  assert(err == 0);

  err = uv_recv_buffer_size((uv_handle_t *) &dgram->handle, &size);

  if (err < 0) {
    err = js_throw_error(env, uv_err_name(err), uv_strerror(err));
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_int32(env, size, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_dgram_send_queue_size(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  js_value_t *result;
  err = js_create_int64(env, (int64_t) uv_udp_get_send_queue_size(&dgram->handle), &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_dgram_send_queue_count(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  js_value_t *result;
  err = js_create_int64(env, (int64_t) uv_udp_get_send_queue_count(&dgram->handle), &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_dgram_ref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uv_ref((uv_handle_t *) &dgram->handle);

  return NULL;
}

static js_value_t *
bare_dgram_unref(js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  bare_dgram_t *dgram;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &dgram, NULL);
  assert(err == 0);

  uv_unref((uv_handle_t *) &dgram->handle);

  return NULL;
}

static js_value_t *
bare_dgram_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("init", bare_dgram_init)
  V("connect", bare_dgram_connect)
  V("disconnect", bare_dgram_disconnect)
  V("bind", bare_dgram_bind)
  V("open", bare_dgram_open)
  V("resume", bare_dgram_resume)
  V("pause", bare_dgram_pause)
  V("send", bare_dgram_send)
  V("close", bare_dgram_close)
  V("address", bare_dgram_address)
  V("setBroadcast", bare_dgram_set_broadcast)
  V("setTTL", bare_dgram_set_ttl)
  V("setMulticastTTL", bare_dgram_set_multicast_ttl)
  V("setMulticastLoopback", bare_dgram_set_multicast_loopback)
  V("setMulticastInterface", bare_dgram_set_multicast_interface)
  V("setMembership", bare_dgram_set_membership)
  V("setSourceMembership", bare_dgram_set_source_membership)
  V("sendBufferSize", bare_dgram_send_buffer_size)
  V("recvBufferSize", bare_dgram_recv_buffer_size)
  V("sendQueueSize", bare_dgram_send_queue_size)
  V("sendQueueCount", bare_dgram_send_queue_count)
  V("ref", bare_dgram_ref)
  V("unref", bare_dgram_unref)
#undef V

#define V(name, n) \
  { \
    js_value_t *val; \
    err = js_create_uint32(env, n, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("MAX_ADDRESS_LENGTH", sizeof(bare_dgram_address_t) - 1 /* NULL */)

  V("UV_UDP_IPV6ONLY", UV_UDP_IPV6ONLY)
  V("UV_UDP_REUSEADDR", UV_UDP_REUSEADDR)
  V("UV_UDP_REUSEPORT", UV_UDP_REUSEPORT)
#undef V

  return exports;
}

BARE_MODULE(bare_dgram, bare_dgram_exports)
