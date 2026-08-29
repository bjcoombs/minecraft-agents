#!/usr/bin/env python3
import time
CONSOLE = "/private/tmp/claude-501/-Users-ben-dev-github-com-bjcoombs/929c69d7-c008-4613-815b-a9bf8b9db549/scratchpad/mcserver26/console"
OX, OY, OZ = -420, 64, -60
PALE="smooth_sandstone"; PALE2="cut_sandstone"; TRIM="chiseled_sandstone"
GOLD="gold_block"; SLAB="smooth_sandstone_slab"; STAIR="smooth_sandstone_stairs"
WALL="sandstone_wall"; GLASS="white_stained_glass"; BLACK="black_concrete"; WHITE="white_concrete"
def cmd(c):
    with open(CONSOLE,"w") as f: f.write(c+"\n")
    time.sleep(0.12)
def fill(a,b,c_,d,e,f_,blk): cmd(f"fill {a} {b} {c_} {d} {e} {f_} {blk}")
def setb(x,y,z,blk): cmd(f"setblock {x} {y} {z} {blk}")
R = 6
CY = OY + 72                      # centre height of the clock faces

# ---- clock stage: slightly wider, gold-trimmed ----
fill(OX-R-1, OY+69, OZ-R-1, OX+R+1, OY+82, OZ+R+1, PALE)
fill(OX-R,   OY+69, OZ-R,   OX+R,   OY+82, OZ+R,   "air")
fill(OX-R-1, OY+69, OZ-R-1, OX+R+1, OY+69, OZ+R+1, GOLD)
fill(OX-R,   OY+69, OZ-R,   OX+R,   OY+69, OZ+R,   "air")

# ---- four clock faces ----
# white dial 7x7 with a black rim, gold surround, hands at ten-past-ten
faces = [(0,-R-1,'z'), (0,R+1,'z'), (-R-1,0,'x'), (R+1,0,'x')]
for fx, fz, axis in faces:
    for a in range(-3, 4):
        for b in range(-3, 4):
            ring = max(abs(a), abs(b))
            if ring > 3: continue
            block = WHITE if ring < 3 else BLACK
            if axis == 'z':
                setb(OX+a, CY+b, OZ+fz, block)
            else:
                setb(OX+fx, CY+b, OZ+a, block)
    # gold surround
    for a in range(-4, 5):
        for b in (-4, 4):
            if axis == 'z':
                setb(OX+a, CY+b, OZ+fz, GOLD); setb(OX+b, CY+a, OZ+fz, GOLD)
            else:
                setb(OX+fx, CY+b, OZ+a, GOLD); setb(OX+fx, CY+a, OZ+b, GOLD)
    # hands: hour to 10, minute to 2
    for i in range(1, 3):
        if axis == 'z':
            setb(OX-i, CY+i, OZ+fz, BLACK)
            setb(OX+i, CY+i, OZ+fz, BLACK)
        else:
            setb(OX+fx, CY+i, OZ-i, BLACK)
            setb(OX+fx, CY+i, OZ+i, BLACK)
    if axis == 'z': setb(OX, CY, OZ+fz, BLACK)
    else: setb(OX+fx, CY, OZ, BLACK)
print("clock faces done", flush=True)

# ---- belfry above the clocks, where the bell hangs ----
fill(OX-R, OY+83, OZ-R, OX+R, OY+92, OZ+R, PALE)
fill(OX-R+1, OY+83, OZ-R+1, OX+R-1, OY+92, OZ+R-1, "air")
for dz in (-R, R):
    fill(OX-3, OY+85, OZ+dz, OX+3, OY+91, OZ+dz, "air")
    for x in range(-3, 4):
        setb(OX+x, OY+92, OZ+dz, STAIR)
for dx in (-R, R):
    fill(OX+dx, OY+85, OZ-3, OX+dx, OY+91, OZ+3, "air")
# the bell itself
fill(OX-1, OY+88, OZ-1, OX+1, OY+90, OZ+1, GOLD)
setb(OX, OY+91, OZ, "chain")
setb(OX, OY+87, OZ, "bell[attachment=ceiling]")
print("belfry done", flush=True)
