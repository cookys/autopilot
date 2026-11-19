#!/usr/bin/env bash
set -e
node -e "const {validateUser}=require('./src/validate'); if(!validateUser({name:'a'}).ok) process.exit(1)"
echo ok
