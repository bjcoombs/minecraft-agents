#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = 120, 72, 120
STONE="stone_bricks"; SLAB="stone_brick_slab"; STAIR="stone_brick_stairs"
GLASS="white_stained_glass"; WALL="stone_brick_wall"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.13)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")

NW, NE = OX, OX+70
NZ1, NZ2 = OZ, OZ+18
H = 22
CX, CZ = OX+40, OZ+9

# ---- interior: nave columns, vaulting, floor ----
fill(NW+1, OY-1, NZ1+1, NE-1, OY-1, NZ2-1, "polished_andesite")
# chequer the aisle
for x in range(NW+1, NE, 2):
    for z in range(NZ1+1, NZ2, 2):
        setb(x, OY-1, z, "polished_diorite")

for x in range(NW+6, NE-4, 7):
    for z in (NZ1+4, NZ2-4):
        fill(x, OY, z, x, OY+13, z, STONE)                # pillar
        for d in ((1,0),(-1,0),(0,1),(0,-1)):             # capital
            setb(x+d[0], OY+14, z+d[1], STAIR)
        fill(x, OY+14, z, x, OY+15, z, STONE)
print("columns done", flush=True)

# ---- choir and altar at the east end ----
fill(NE-14, OY, NZ1+6, NE-2, OY+1, NZ2-6, "polished_andesite")
fill(NE-6, OY+1, NZ1+8, NE-4, OY+2, NZ2-8, "quartz_block")
setb(NE-5, OY+3, CZ, "lantern[hanging=false]")
# great east window
fill(NE, OY+6, NZ1+5, NE, OY+19, NZ2-5, GLASS)
# pews
for x in range(NW+8, NE-18, 3):
    fill(x, OY, NZ1+5, x, OY, NZ1+7, STAIR+"[facing=east]")
    fill(x, OY, NZ2-7, x, OY, NZ2-5, STAIR+"[facing=east]")
print("choir done", flush=True)

# ---- lighting ----
for x in range(NW+5, NE, 6):
    setb(x, OY+10, NZ1+1, "lantern[hanging=true]")
    setb(x, OY+10, NZ2-1, "lantern[hanging=true]")
for z in range(NZ1+2, NZ2, 4):
    setb(CX, OY+18, z, "lantern[hanging=true]")
print("lighting done", flush=True)

# ---- cloister to the north ----
CLX, CLZ = NW+8, NZ1-24
fill(CLX, OY, CLZ, CLX+34, OY+7, CLZ+20, STONE)
fill(CLX+1, OY, CLZ+1, CLX+33, OY+6, CLZ+19, "air")
fill(CLX+4, OY, CLZ+4, CLX+30, OY+7, CLZ+16, "air")       # open garth
fill(CLX+4, OY-1, CLZ+4, CLX+30, OY-1, CLZ+16, "grass_block")
for x in range(CLX+2, CLX+33, 3):                          # arcade
    fill(x, OY+1, CLZ+3, x, OY+5, CLZ+3, "air")
    fill(x, OY+1, CLZ+17, x, OY+5, CLZ+17, "air")
fill(CLX, OY+8, CLZ, CLX+34, OY+8, CLZ+20, SLAB)
print("cloister done", flush=True)
