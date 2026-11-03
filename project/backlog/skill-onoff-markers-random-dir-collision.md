# skill-onoff-markers suite is occasionally red, suspected $RANDOM directory collision

BL-0312. `make_repo` in the skill-onoff-markers suite is suspected of naming its temp directory with `$RANDOM`, so two runs can collide. It goes red occasionally and is green on rerun. Not reproduced; the cause is unconfirmed. Direction: name the directory with `mktemp -d`.
