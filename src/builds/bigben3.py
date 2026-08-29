#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = -420, 64, -60
PALE="smooth_sandstone"; TRIM="chiseled_sandstone"; GOLD="gold_block"
SLAB="smooth_sandstone_slab"; STAIR="smooth_sandstone_stairs"; WALL="sandstone_wall"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.12)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")
R = 6

# ---- corner turrets flanking the spire ----
for dx, dz in [(-R,-R),(R,-R),(-R,R),(R,R)]:
    fill(OX+dx, OY+83, OZ+dz, OX+dx, OY+97, OZ+dz, PALE)
    for i in range(4):
        setb(OX+dx, OY+98+i, OZ+dz, WALL)
    setb(OX+dx, OY+102, OZ+dz, GOLD)

# ---- the spire: square pyramid tapering over 20 blocks ----
y = OY + 93
r = R - 1
while r >= 0:
    for a in range(-r, r+1):
        for b in range(-r, r+1):
            if max(abs(a), abs(b)) == r:
                setb(OX+a, y, OZ+b, PALE)
    if r <= 2:
        for a in range(-r, r+1):
            for b in range(-r, r+1):
                setb(OX+a, y, OZ+b, PALE)
    y += 3
    r -= 1

# gilded finial
for i in range(6):
    setb(OX, y+i, OZ, GOLD if i % 2 == 0 else WALL)
setb(OX, y+6, OZ, "lightning_rod")
print(f"spire done, apex y={y+6}", flush=True)

# ---- ground: a bit of Westminster around the base ----
fill(OX-14, OY-1, OZ-14, OX+14, OY-1, OZ+14, "stone_bricks")
for i in range(-14, 15, 4):
    setb(OX+i, OY, OZ-14, "lantern[hanging=false]")
    setb(OX+i, OY, OZ+14, "lantern[hanging=false]")
    setb(OX-14, OY, OZ+i, "lantern[hanging=false]")
    setb(OX+14, OY, OZ+i, "lantern[hanging=false]")
# doorway
fill(OX-1, OY+1, OZ-R-1, OX+1, OY+4, OZ-R-1, "air")
setb(OX, OY+1, OZ-R-1, "oak_door[half=lower,facing=north]")
setb(OX, OY+2, OZ-R-1, "oak_door[half=upper,facing=north]")
cmd("gamerule sendCommandFeedback true")
print("grounds done", flush=True)
