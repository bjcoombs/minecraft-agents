#!/usr/bin/env python3
"""Minimal RCON client. The console FIFO kept losing its reader - a duplicate
server process would steal the input, or the server would see EOF and stop
reading stdin entirely, and every admin command silently vanished. RCON is a
real request/response protocol, so a command either works or reports why."""
import socket, struct, sys
HOST, PORT, PW = "127.0.0.1", 25575, "botsrcon"
def pkt(i, t, body): 
    b = struct.pack("<ii", i, t) + body.encode() + b"\x00\x00"
    return struct.pack("<i", len(b)) + b
def recv(s):
    ln = struct.unpack("<i", s.recv(4))[0]
    data = b""
    while len(data) < ln: data += s.recv(ln - len(data))
    i, t = struct.unpack("<ii", data[:8])
    return i, t, data[8:-2].decode("utf-8", "ignore")
def run(cmds):
    with socket.create_connection((HOST, PORT), timeout=20) as s:
        s.sendall(pkt(1, 3, PW))
        i, t, _ = recv(s)
        if i == -1: return ["AUTH FAILED"]
        out = []
        for c in cmds:
            s.sendall(pkt(2, 2, c))
            _, _, body = recv(s)
            out.append(body.strip())
        return out
if __name__ == "__main__":
    for line in run(sys.argv[1:]): print(line or "(no output)")
