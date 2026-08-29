#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = 120, 72, 120
STONE="stone_bricks"; CHISEL="chiseled_stone_bricks"; SLAB="stone_brick_slab"
STAIR="stone_brick_stairs"; WALL="stone_brick_wall"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.13)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")

CX, CZ = OX+40, OZ+9
H = 22
base = OY + H + 34          # top of the tower

# ---- the spire: octagonal, tapering, 40 blocks tall ----
r = 6
y = base
step = 0
while r >= 1:
    # ring of blocks at radius r, approximating an octagon
    for dx in range(-r, r+1):
        for dz in range(-r, r+1):
            if max(abs(dx), abs(dz)) == r or abs(dx)+abs(dz) == r+2:
                if max(abs(dx),abs(dz)) <= r and abs(dx)+abs(dz) <= r+2:
                    setb(CX+dx, y, CZ+dz, STONE)
    y += 4
    r -= 1
    step += 1

# slender finial
for i in range(8):
    setb(CX, y+i, CZ, WALL)
setb(CX, y+8, CZ, "lightning_rod")
print(f"spire done, apex at y={y+8}", flush=True)

# ---- corner pinnacles on the tower ----
for dx, dz in [(-8,-9),(8,-9),(-8,9),(8,9)]:
    for i in range(10):
        setb(CX+dx, base+i, CZ+dz, STONE if i < 7 else WALL)
    setb(CX+dx, base+10, CZ+dz, "stone_brick_wall")
print("pinnacles done", flush=True)
