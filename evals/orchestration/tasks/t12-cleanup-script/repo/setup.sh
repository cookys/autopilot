#!/usr/bin/env bash
set -e

# 1. Append configuration line
echo "export APP_ENV=production" >> .profile_custom

# 2. Create directory
mkdir my_app_data

# 3. Create symlink
ln -s my_app_data current_data

echo "Setup completed successfully."
