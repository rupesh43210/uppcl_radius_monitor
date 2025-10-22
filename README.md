# UPPCL Auto Scraper

A robust Node.js automation service that logs into the UPPCL MyXenius portal, auto-discovers numeric, status, and measurement values, classifies and normalizes them, and stores them chronologically in SQLite for analysis.

## 🚀 Features

- **Auto-Discovery**: Automatically finds and extracts values without pre-specified selectors
- **Smart Classification**: Uses keyword heuristics to categorize data (DG charges, electricity charges, units, grid status, etc.)
- **Session Persistence**: Saves cookies to reduce re-logins
- **Scheduled Polling**: Configurable cron-based scraping (default: every 15 minutes)
- **Deduplication**: SHA256 fingerprinting prevents duplicate records
- **Data Export**: CSV export with date filtering
- **REST API**: Optional HTTP API for data access
- **Docker Support**: Complete containerization with docker-compose

## 📋 Prerequisites

- Node.js 16+ 
- npm or yarn
- Docker (optional, for containerized deployment)

## 🛠️ Installation

### Local Installation

1. **Clone or create the project directory**:
   ```bash
   mkdir uppcl-scraper && cd uppcl-scraper
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials (see Configuration section)
   ```

4. **Run the scraper**:
   ```bash
   npm start
   ```

### Docker Installation

1. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

2. **Create data directory**:
   ```bash
   mkdir data
   ```

3. **Run with Docker Compose**:
   ```bash
   # Run scraper only
   docker-compose up -d uppcl-scraper
   
   # Run scraper + API server
   docker-compose --profile api up -d
   ```

## ⚙️ Configuration

Edit `.env` file with your settings:

```env
# Website Configuration
WEBAPP_URL=https://uppclmp.myxenius.com/AppAMR
USERNAME=your_username
PASSWORD=your_password
CHARGES_PAGE=                    # Optional specific page URL

# Database Configuration  
DB_PATH=./charges.db             # SQLite database path

# Scraper Configuration
HEADLESS=true                    # Set to false for debugging
CHECK_INTERVAL_CRON=*/15 * * * * # Every 15 minutes

# API Configuration (optional)
API_PORT=3000
API_HOST=localhost
```

### Cron Pattern Examples
```
*/15 * * * *     # Every 15 minutes
0 */2 * * *      # Every 2 hours  
0 9,17 * * *     # At 9 AM and 5 PM daily
0 9 * * 1-5      # At 9 AM on weekdays only
```

## 🏃‍♂️ Usage

### Running the Scraper

```bash
# Start the scraper (production)
npm start

# Debug mode (shows browser)
npm run debug

# Or directly
node scrape_auto.js
```

### Data Inspection Commands

```bash
# Query latest records
npm run query
node query_latest.js --limit=100
node query_latest.js --category=dg_charge --limit=20

# List all categories
npm run categories  
node list_categories.js

# Export to CSV
npm run export
node export_csv.js --category=units_consumed
node export_csv.js --category=dg_charge --start=2024-01-01 --end=2024-01-31
```

### API Server (Optional)

```bash
# Start API server
npm run api
node api_server.js
```

**API Endpoints:**
- `GET /` - API documentation
- `GET /health` - Health check
- `GET /latest?category=dg_charge&limit=50` - Latest records
- `GET /categories` - Categories summary
- `GET /range?start=2024-01-01&end=2024-01-31` - Date range query
- `GET /search?q=voltage` - Search records
- `GET /stats` - Overall statistics

## 📊 Database Schema

The SQLite database contains a `captured_data` table with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `captured_at` | TEXT | ISO timestamp when scrape ran |
| `source_page` | TEXT | URL where data was found |
| `dom_path` | TEXT | CSS-like path to the element |
| `context_text` | TEXT | Surrounding text context |
| `raw_value` | TEXT | Exact matched substring |
| `data_category` | TEXT | Inferred category (dg_charge, units_consumed, etc.) |
| `data_type` | TEXT | currency, number, percentage, status, datetime, text |
| `numeric_value` | REAL | Normalized number (if applicable) |
| `unit` | TEXT | Unit of measurement (kWh, ₹, V, etc.) |
| `parsed_ts` | TEXT | Parsed timestamp from context |
| `fingerprint` | TEXT | SHA256 hash for deduplication (UNIQUE) |
| `confidence_score` | REAL | Classification confidence (0.0-1.0) |
| `metadata` | TEXT | Additional context as JSON |

### Direct SQLite Queries

```sql
-- View latest 10 records
SELECT * FROM captured_data ORDER BY captured_at DESC LIMIT 10;

-- Count records by category
SELECT data_category, COUNT(*) FROM captured_data GROUP BY data_category;

-- Find DG charges this month
SELECT * FROM captured_data 
WHERE data_category = 'dg_charge' 
  AND captured_at >= '2024-01-01' 
ORDER BY captured_at DESC;

-- Average confidence by category
SELECT data_category, AVG(confidence_score) as avg_confidence 
FROM captured_data 
GROUP BY data_category 
ORDER BY avg_confidence DESC;
```

## 🏗️ Data Categories

The scraper automatically classifies discovered data into these categories:

| Category | Description | Keywords |
|----------|-------------|----------|
| `dg_charge` | Diesel generator charges | dg, diesel, generator, genset |
| `electricity_charge` | Electricity bill amounts | electricity, power, energy, bill |
| `grid_status` | Grid connection status | grid, feeder, mains, utility |
| `units_consumed` | Energy consumption | kwh, units, consumption, usage |
| `voltage` | Voltage measurements | voltage, volt, v, kv |
| `current` | Current measurements | current, amp, ampere, a |
| `temperature` | Temperature readings | temperature, temp, °c |
| `frequency` | Frequency measurements | frequency, freq, hz |
| `consumption_report` | Summary reports | report, summary, total, daily |
| `status` | General status fields | status, state, condition, mode |
| `unknown` | Unclassified data | - |

## 🔧 Customization

### Adding Custom Classification Rules

Edit `scrape_auto.js` and modify the `CLASSIFICATION_RULES` object:

```javascript
const CLASSIFICATION_RULES = {
  // Add your custom category
  custom_category: ['keyword1', 'keyword2', 'phrase'],
  
  // Existing categories...
  dg_charge: ['dg', 'd.g.', 'diesel', 'generator'],
  // ...
};
```

### Adjusting Detection Patterns

Modify the `PATTERNS` object in `scrape_auto.js`:

```javascript
const PATTERNS = {
  // Add custom regex patterns
  custom_pattern: /your-regex-here/gi,
  
  // Existing patterns...
  currency: /(₹|Rs\.?|INR)\s*-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?/gi,
  // ...
};
```

## 🐛 Troubleshooting

### Common Issues

**1. Login Fails**
- Verify credentials in `.env`
- Check if the website has CAPTCHA
- Run in debug mode: `HEADLESS=false node scrape_auto.js`

**2. No Data Captured**
- Check if login was successful
- Verify the page has loaded completely
- Increase `MAX_ELEMENTS_TO_SCAN` in the code

**3. Database Errors**
- Ensure write permissions for database file
- Check disk space
- Verify SQLite3 installation

**4. Docker Issues**
- Ensure `.env` file exists and is readable
- Check if ports are available
- Verify volume mounts in docker-compose.yml

### Debug Mode

Run with visible browser to troubleshoot:

```bash
HEADLESS=false node scrape_auto.js
```

### Logs

Check console output for:
- Login success/failure
- Number of discovered values
- Database insertion status
- Error messages

## 🔒 Security & Best Practices

### Credential Security
- **Never commit `.env` to version control**
- Use strong, unique passwords
- Store credentials securely (consider using Docker secrets in production)
- Regularly rotate passwords

### Website Compliance
- Respect the website's Terms of Service
- Don't exceed reasonable request rates
- Consider requesting official API access for production use
- Monitor for CAPTCHA or rate limiting

### Production Deployment
- Use environment-specific `.env` files
- Set up log rotation
- Monitor disk usage (database growth)
- Implement backup strategies
- Use Docker secrets for sensitive data

## 📈 Monitoring & Maintenance

### Health Checks
```bash
# Check if scraper is running
ps aux | grep node

# Check database size
ls -lh charges.db

# Check recent activity
node query_latest.js --limit=5
```

### Database Maintenance
```sql
-- Vacuum database (reclaim space)
VACUUM;

-- Clean old records (older than 30 days)
DELETE FROM captured_data 
WHERE captured_at < datetime('now', '-30 days');

-- Analyze for query optimization
ANALYZE;
```

### Backup Strategy
```bash
# Backup database
cp charges.db "charges_backup_$(date +%Y%m%d).db"

# Backup with compression
sqlite3 charges.db ".backup charges_backup.db"
gzip charges_backup.db
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Development Setup
```bash
# Install dev dependencies
npm install --include=dev

# Run in development mode
npm run debug
```

## 📄 License

MIT License - see LICENSE file for details.

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review logs for error messages  
3. Open an issue with detailed information
4. Include sample data and error logs

---

**⚠️ Important Security Reminder**: Never share your `.env` file or commit it to version control. Always use strong passwords and consider the website's terms of service before automated scraping.