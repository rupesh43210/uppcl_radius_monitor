#!/bin/bash

# UPPCL Data Backup Script
# Creates timestamped backups of the power monitoring database

BACKUP_DIR="/Users/rupesh/Desktop/UppclProject/backups"
DB_FILE="/Users/rupesh/Desktop/UppclProject/power_data.db"
TIMESTAMP=$(date "+%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/power_data_backup_$TIMESTAMP.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo "❌ Database file not found: $DB_FILE"
    exit 1
fi

# Create backup
echo "📦 Creating backup of power monitoring database..."
cp "$DB_FILE" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Backup created successfully: $BACKUP_FILE"
    
    # Show backup info
    RECORDS=$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM power_data;")
    OLDEST=$(sqlite3 "$BACKUP_FILE" "SELECT MIN(timestamp) FROM power_data;")
    NEWEST=$(sqlite3 "$BACKUP_FILE" "SELECT MAX(timestamp) FROM power_data;")
    
    echo "📊 Backup contains:"
    echo "   • Total records: $RECORDS"
    echo "   • Date range: $OLDEST to $NEWEST"
    echo "   • File size: $(ls -lh "$BACKUP_FILE" | awk '{print $5}')"
    
    # Clean up old backups (keep last 7 days)
    echo "🧹 Cleaning up old backups (keeping last 7 days)..."
    find "$BACKUP_DIR" -name "power_data_backup_*.db" -mtime +7 -delete
    
    echo "✅ Backup process completed!"
else
    echo "❌ Backup failed!"
    exit 1
fi