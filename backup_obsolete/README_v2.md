# UPPCL Power Monitor v2.0

🔌 **Optimized UPPCL Power Monitoring System with Web Dashboard**

A clean, optimized solution for monitoring Grid and DG (Diesel Generator) availability and power consumption from the UPPCL MyXenius portal.

## ✨ Features

### Core Monitoring
- **Real-time Grid/DG Status**: Monitor online/offline status via LED indicators
- **Power Consumption Tracking**: Track monthly/daily consumption by source (Grid/DG)
- **Smart Data Extraction**: Pattern-based detection for consumption values
- **Deduplication**: SHA256 fingerprinting prevents duplicate records
- **Scheduled Monitoring**: Configurable cron-based scheduling

### Web Dashboard
- **Real-time Status Display**: Live Grid and DG status indicators
- **Consumption Metrics**: Visual consumption data with units
- **Historical Data**: View last 24 hours of activity
- **Manual Triggers**: Force monitoring cycles via web interface
- **Responsive Design**: Works on desktop and mobile

### Data Management
- **SQLite Database**: Lightweight, file-based storage
- **Clean Schema**: Optimized table structure for power data
- **REST API**: JSON endpoints for external integrations
- **Export Capabilities**: CSV export functionality

## 🚀 Quick Start

### 1. Configuration
Create `.env` file:
```bash
USERNAME=your_uppcl_username
PASSWORD=your_uppcl_password
HEADLESS=true
```

### 2. Installation
```bash
npm install
```

### 3. Run Options

#### Single Monitoring Run
```bash
npm start
```

#### Scheduled Monitoring (Every 5 minutes)
```bash
npm run schedule
```

#### Web Dashboard
```bash
npm run dashboard
```
Then open: http://localhost:3000

#### Debug Mode (Visible Browser)
```bash
npm run debug
```

## 📊 Dashboard Overview

### Status Cards
- **Grid Status**: Real-time availability (Online/Offline/Unknown)
- **DG Status**: Real-time generator availability
- **Consumption Data**: Monthly consumption values with units
- **Last Updated**: Timestamp of latest data

### Controls
- **Refresh Data**: Manual data refresh
- **Trigger Monitoring**: Force a monitoring cycle
- **View History**: Toggle historical data table

### API Endpoints
- `GET /api/status` - Current Grid/DG status
- `GET /api/history?hours=24` - Historical data
- `POST /api/trigger-monitoring` - Manual trigger
- `GET /api/health` - Health check

## 🔧 Data Structure

### Power Data Schema
```sql
CREATE TABLE power_data (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,    -- 'availability' or 'consumption'
  source TEXT NOT NULL,      -- 'grid' or 'dg'
  status TEXT,               -- 'online', 'offline', 'unknown'
  consumption_value REAL,    -- Numeric consumption value
  consumption_unit TEXT,     -- 'KWH', 'kwh', etc.
  period TEXT,               -- 'monthly', 'daily', 'detected'
  confidence REAL,           -- 0.0 to 1.0 confidence score
  metadata TEXT,             -- JSON metadata
  fingerprint TEXT UNIQUE    -- Deduplication hash
);
```

### Sample Data Extraction

**Grid Availability:**
```json
{
  "category": "availability",
  "source": "grid", 
  "status": "online",
  "confidence": 1.0
}
```

**Consumption Data:**
```json
{
  "category": "consumption",
  "source": "grid",
  "value": 166.00,
  "unit": "KWH",
  "period": "monthly",
  "confidence": 1.0
}
```

## 🎯 Key Improvements from v1.0

### Code Optimization
- **Reduced Complexity**: Simplified from 1,500+ lines to ~400 lines
- **Focused Extraction**: Target only Grid/DG and consumption data
- **Clean Architecture**: Separated concerns (monitor, dashboard, API)
- **Better Error Handling**: Graceful failures and retries

### Performance
- **Faster Extraction**: Direct pattern matching vs DOM traversal
- **Efficient Database**: Optimized schema with proper indexes
- **Minimal Dependencies**: Reduced package overhead
- **Smart Scheduling**: Configurable intervals based on needs

### User Experience
- **Web Dashboard**: Modern, responsive interface
- **Real-time Updates**: Live status indicators
- **Visual Feedback**: Status colors and animations
- **Mobile Friendly**: Works on all devices

## 📈 Monitoring Strategy

### Detection Patterns

**LED Status Detection:**
```javascript
// Grid LED indicators
img[title*="Grid" i], img[alt*="Grid" i]

// DG LED indicators  
img[title*="DG" i], img[title*="Generator" i]

// Status determination
green LED = online
red LED = offline
```

**Consumption Patterns:**
```javascript
// Grid consumption
/Grid[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh)/i

// DG consumption
/(?:DG|Generator)[\s:]*(\d+(?:\.\d+)?)\s*(KWH|kwh)/i

// Monthly indicators
context.includes('Month') ? 'monthly' : 'detected'
```

### Confidence Scoring
- **Availability**: 1.0 for clear online/offline, 0.5 for unknown
- **Consumption**: 1.0 for monthly data, 0.9 for detected patterns
- **Context**: Higher confidence for structured vs unstructured data

## 🛠 Development

### Project Structure
```
UppclProject/
├── monitor.js              # Main runner script
├── optimized_monitor.js     # Core monitoring class
├── dashboard_server.js      # Web dashboard server
├── dashboard/
│   └── index.html          # Dashboard interface
├── power_data.db           # SQLite database
└── package.json            # Dependencies
```

### Legacy Files (v1.0)
- `scrape_auto.js` - Original complex scraper
- `captcha_solver.js` - CAPTCHA solving logic
- `charges.db` - Original database
- Analytics scripts - Data analysis tools

### Adding New Features

**Custom Patterns:**
```javascript
// Add to extractPowerData() method
const customPattern = /Your[\s:]*(\d+)\s*(UNIT)/gi;
// Process matches...
```

**New Dashboard Elements:**
```html
<!-- Add to dashboard/index.html -->
<div class="status-card">
  <!-- Your custom card -->
</div>
```

## 🔍 Troubleshooting

### Common Issues

**Login Failed:**
- Check USERNAME/PASSWORD in .env
- Verify UPPCL portal accessibility
- Check for CAPTCHA requirements

**No Data Extracted:**
- Run with `npm run debug` to see browser
- Check for UI changes in UPPCL portal
- Verify LED selectors are still valid

**Dashboard Not Loading:**
- Ensure port 3000 is available
- Check for JavaScript errors in browser console
- Verify database file permissions

### Debug Commands
```bash
# Visual browser mode
npm run debug

# Check database
sqlite3 power_data.db ".tables"
sqlite3 power_data.db "SELECT * FROM power_data LIMIT 5;"

# API health check
curl http://localhost:3000/api/health
```

## 📝 Contributing

1. Focus on Grid/DG monitoring only
2. Maintain clean, readable code
3. Test with real UPPCL portal
4. Update dashboard for new features
5. Document any breaking changes

## 📄 License

MIT License - Use freely for monitoring your power systems.

---

**Built for reliable Grid/DG monitoring with a focus on simplicity and effectiveness.**