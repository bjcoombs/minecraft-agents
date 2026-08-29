#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = 120, 72, 120
STONE="stone_bricks"; CHISEL="chiseled_stone_bricks"; SLAB="stone_brick_slab"
STAIR="stone_brick_stairs"; GLASS="white_stained_glass"; WALL="stone_brick_wall"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.13)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")

NW, NE = OX, OX+70
NZ1, NZ2 = OZ, OZ+18
H = 22

# ---- west front: the screen facade with the great door ----
fill(NW-2, OY, NZ1-3, NW-2, OY+H+6, NZ2+3, STONE)
fill(NW-2, OY+1, NZ1+7, NW-2, OY+7, NZ1+11, "air")        # great west door
for i in range(5):
    setb(NW-2, OY+8+i, NZ1+7+i, STAIR+"[facing=south,half=bottom]")
    setb(NW-2, OY+8+i, NZ1+11-i, STAIR+"[facing=north,half=bottom]")
fill(NW-2, OY+11, NZ1+6, NW-2, OY+20, NZ1+12, GLASS)      # west window
# flanking turrets
for z in (NZ1-3, NZ2+3):
    fill(NW-3, OY, z-1, NW-1, OY+H+12, z+1, STONE)
    fill(NW-3, OY+H+12, z-1, NW-1, OY+H+12, z+1, SLAB)
print("west front done", flush=True)

# ---- flying buttresses down both flanks ----
for x in range(NW+6, NE-2, 7):
    for z, d in ((NZ1, -1), (NZ2, 1)):
        zz = z + 4*d
        fill(x, OY, zz, x+1, OY+11, zz, STONE)            # pier
        for i in range(4):                                 # arching brace
            setb(x, OY+12+i, z + (3-i)*d, STONE)
            setb(x+1, OY+12+i, z + (3-i)*d, STONE)
        setb(x, OY+12, zz, WALL); setb(x+1, OY+12, zz, WALL)
print("buttresses done", flush=True)

# ---- roofs ----
for t in range(10):                                        # nave gable
    y = OY+H+t
    fill(NW-2, y, NZ1+t, NE, y, NZ1+t, STAIR+"[facing=south]")
    fill(NW-2, y, NZ2-t, NE, y, NZ2-t, STAIR+"[facing=north]")
    if NZ1+t < NZ2-t:
        fill(NW-2, y, NZ1+t+1, NE, y, NZ2-t-1, STONE)
fill(NW-2, OY+H+10, NZ1+9, NE, OY+H+10, NZ1+9, SLAB)
print("roof done", flush=True)
