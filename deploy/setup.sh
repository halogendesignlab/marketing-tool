#!/bin/bash
# setup.sh - Bootstrap a fresh Ubuntu 22.04 VPS for the marketing automation platform
# Run as root: bash setup.sh

set -e

APP_DIR="/opt/marketing-tool"
APP_USER="marketing"
DOMAIN="${DOMAIN:-portal.halogendesignlab.com}"

echo "==> Installing system dependencies"
apt-get update -q
apt-get install -y -q python3.11 python3.11-venv python3-pip postgresql postgresql-contrib nginx certbot python3-certbot-nginx nodejs npm git curl

echo "==> Creating app user"
id -u $APP_USER &>/dev/null || useradd -m -s /bin/bash $APP_USER

echo "==> Setting up PostgreSQL"
sudo -u postgres psql -c "CREATE USER marketing WITH PASSWORD 'changeme';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE marketing_tool OWNER marketing;" 2>/dev/null || true

echo "==> Cloning/copying app"
mkdir -p $APP_DIR
chown $APP_USER:$APP_USER $APP_DIR

echo "==> Setting up Python venv"
sudo -u $APP_USER python3.11 -m venv $APP_DIR/.venv
sudo -u $APP_USER $APP_DIR/.venv/bin/pip install -q -r $APP_DIR/requirements.txt

echo "==> Building Next.js frontend"
cd $APP_DIR/portal/frontend
sudo -u $APP_USER npm install --include=dev
sudo -u $APP_USER npm run build

echo "==> Installing systemd service"
cp $APP_DIR/deploy/marketing-tool.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable marketing-tool

echo "==> Configuring nginx"
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/marketing-tool
ln -sf /etc/nginx/sites-available/marketing-tool /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "==> Obtaining SSL certificate"
certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m hello@halogendesignlab.com

echo ""
echo "==> Setup complete!"
echo "    1. Copy your .env file to $APP_DIR/.env"
echo "    2. Run: systemctl start marketing-tool"
echo "    3. Run: sudo -u $APP_USER $APP_DIR/.venv/bin/python $APP_DIR/run.py --client moorhouse_commercial --task onboard"
