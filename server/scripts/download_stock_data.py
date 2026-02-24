#!/usr/bin/env python3
"""
Fast Stock Database Downloader
Downloads just the essential stock listing data without slow enrichment.
"""

import os
import requests
import csv
import json
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Get the server directory (parent of scripts directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(SCRIPT_DIR)  # parent directory of scripts

# File paths relative to server directory
STOCK_DATABASE_PATH = os.path.join(SERVER_DIR, 'data', 'stock_database.json')
API_KEY_PATH = os.path.join(SERVER_DIR, 'keys', 'alphavantage_key.txt')


def get_alpha_vantage_key():
    """Load Alpha Vantage API key using same method as ConfigService"""
    # Try environment variable first
    key = os.environ.get('ALPHA_VANTAGE_API_KEY')
    if key:
        return key

    # Try file next
    try:
        with open(API_KEY_PATH, 'r') as file:
            key = file.readline().strip()
            if key:
                return key
    except FileNotFoundError:
        logger.warning(f"API key file not found: {API_KEY_PATH}")

    return None


def download_stock_database():
    """Download stock listings from Alpha Vantage and create database"""
    # Get API key
    api_key = get_alpha_vantage_key()
    if not api_key:
        logger.error(f"Alpha Vantage API key not found. Please add it to {API_KEY_PATH}")
        return False

    logger.info("Downloading stock listings from Alpha Vantage...")

    try:
        # Create directories if they don't exist
        os.makedirs(os.path.dirname(STOCK_DATABASE_PATH), exist_ok=True)

        # Get stock listings (this returns a CSV)
        url = f"https://www.alphavantage.co/query?function=LISTING_STATUS&apikey={api_key}"
        response = requests.get(url, timeout=30)

        if response.status_code != 200:
            logger.error(f"Error: Alpha Vantage returned status code {response.status_code}")
            return False

        # Parse CSV data
        lines = response.text.strip().split('\n')
        reader = csv.DictReader(lines)

        all_stocks = []
        for row in reader:
            all_stocks.append(row)

        if not all_stocks:
            logger.warning("No stocks found in Alpha Vantage response")
            return False

        # Create stock database in JSON format
        stock_dict = {}
        for stock in all_stocks:
            if stock.get('symbol'):
                symbol = stock.get('symbol')
                stock_dict[symbol] = {
                    'symbol': symbol,
                    'name': stock.get('name', ''),
                    'exchange': stock.get('exchange', ''),
                    'assetType': stock.get('assetType', ''),
                    'status': stock.get('status', ''),
                    'ipoDate': stock.get('ipoDate', ''),
                    'sector': '',  # Placeholder
                    'industry': '',
                    'ceo': ''
                }

        # Add a few sector values for the most common stocks
        # This helps with the search UI without requiring API calls
        common_sectors = {
            'AAPL': 'Technology',
            'MSFT': 'Technology',
            'GOOGL': 'Technology',
            'AMZN': 'Consumer Cyclical',
            'META': 'Technology',
            'TSLA': 'Consumer Cyclical',
            'NVDA': 'Technology',
            'JPM': 'Financial Services',
            'V': 'Financial Services',
            'JNJ': 'Healthcare'
        }

        for symbol, sector in common_sectors.items():
            if symbol in stock_dict:
                stock_dict[symbol]['sector'] = sector

        with open(STOCK_DATABASE_PATH, 'w') as f:
            json.dump(stock_dict, f)

        logger.info(f"Successfully created stock database with {len(stock_dict)} entries at {STOCK_DATABASE_PATH}")
        return True

    except Exception as e:
        logger.error(f"Error downloading stock database: {e}")
        return False


if __name__ == "__main__":
    logger.info(f"Starting fast stock database download to {STOCK_DATABASE_PATH}...")
    logger.info(f"Using Alpha Vantage API key from {API_KEY_PATH}")

    success = download_stock_database()

    if success:
        logger.info("Download complete! The database is ready to use.")
        logger.info(f"Database saved to: {STOCK_DATABASE_PATH}")
    else:
        logger.error("Failed to download stock database.")