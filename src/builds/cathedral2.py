#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = 120, 72, 120
STONE="stone_bricks"; CHISEL="chiseled_stone_bricks"; SLAB="stone_brick_slab"
STAIR="stone_brick_stairs"; GLASS="white_stained_glass"; WALL="stone_brick_wall"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.14)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")

NW, NE = OX, OX+70
NZ1, NZ2 = OZ, OZ+18
H = 22
CX = OX+40                      # crossing centre (east of middle, as at Salisbury)
CZ = OZ+9

# ---------------------------------------------------------- great transept
TZ1, TZ2 = OZ-14, OZ+32
fill(CX-8, OY, TZ1, CX+8, OY+H, TZ2, STONE)
fill(CX-7, OY, TZ1+1, CX+7, OY+H-1, TZ2-1, "air")
# transept end windows - big lancets
for z in (TZ1, TZ2):
    fill(CX-5, OY+6, z, CX-3, OY+18, z, GLASS)
    fill(CX-1, OY+5, z, CX+1, OY+19, z, GLASS)
    fill(CX+3, OY+6, z, CX+5, OY+18, z, GLASS)
print("transept done", flush=True)

# ---------------------------------------------------------- crossing tower
# square tower rising from the crossing
for lvl, (inset, top) in enumerate([(0, H+14), (1, H+26), (2, H+34)]):
    x1, x2 = CX-8+inset, CX+8-inset
    z1, z2 = CZ-9+inset, CZ+9-inset
    base = OY + (H if lvl == 0 else [H+14, H+26][lvl-1])
    fill(x1, base, z1, x2, OY+top, z2, STONE)
    fill(x1+1, base, z1+1, x2-1, OY+top-1, z2-1, "air")
    # belfry openings
    for z in (z1, z2):
        fill(x1+3, base+4, z, x2-3, OY+top-4, z, GLASS)
    for x in (x1, x2):
        fill(x, base+4, z1+3, x, OY+top-4, z2-3, GLASS)
print("tower done", flush=True)
