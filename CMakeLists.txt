cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_dgram C)

bare_target(target)

add_bare_module(bare_dgram)

target_sources(
  ${bare_dgram}
  PRIVATE
    binding.c
)

if(target MATCHES "win32")
  target_link_libraries(
    ${bare_dgram}
    PUBLIC
      ws2_32
  )
endif()
