"""Deny IPv4/IPv6 socket creation in this process and all descendants."""
import ctypes
import errno
import os
import socket
import sys

class Comparison(ctypes.Structure):
    _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_uint),
                ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]

lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(Comparison)]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx:
    raise RuntimeError('Unable to create network guard')
try:
    for call in (b'socket', b'socketpair'):
        number = lib.seccomp_syscall_resolve_name(call)
        if number < 0:
            continue
        for domain in (socket.AF_INET, socket.AF_INET6):
            comparison = Comparison(0, 4, domain, 0)  # SCMP_CMP_EQ
            if lib.seccomp_rule_add_array(ctx, 0x50000 | errno.EPERM, number, 1, ctypes.byref(comparison)) != 0:
                raise RuntimeError('Unable to add network restriction')
    if lib.seccomp_load(ctx) != 0:
        raise RuntimeError('Unable to enforce network guard')
finally:
    lib.seccomp_release(ctx)
if len(sys.argv) < 2:
    raise SystemExit('Expected command')
os.execvpe(sys.argv[1], sys.argv[1:], dict(os.environ))
