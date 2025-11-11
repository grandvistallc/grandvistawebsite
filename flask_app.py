from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import csv
import os

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

CSV_FILE = os.path.join('Views', 'customer-import-template.csv')

@app.route('/')
def index():
    return send_from_directory('Views', 'Customer.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('Views', path)

@app.route('/api/update-customer', methods=['POST'])
def update_customer():
    try:
        data = request.json
        customer_identifier = data.get('identifier')  # Email or Customer name
        updated_fields = data.get('fields')
        
        # Read all rows from CSV
        rows = []
        with open(CSV_FILE, 'r', encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            for row in reader:
                rows.append(row)
        
        # Update matching rows
        updated_count = 0
        for row in rows:
            # Match by email or customer name
            if (row.get('Email') == customer_identifier or 
                row.get('Customer') == customer_identifier):
                # Update fields
                for key, value in updated_fields.items():
                    # Add field to row if it doesn't exist
                    if key not in row and key not in fieldnames:
                        fieldnames = list(fieldnames) + [key]
                    row[key] = value
                updated_count += 1
        
        # Ensure all rows have all fieldnames
        for row in rows:
            for field in fieldnames:
                if field not in row:
                    row[field] = ''
        
        # Write back to CSV
        with open(CSV_FILE, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        
        return jsonify({
            'success': True,
            'message': f'Updated {updated_count} record(s)',
            'updated_count': updated_count
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/add-customer', methods=['POST'])
def add_customer():
    try:
        data = request.json

        # Required fields except only require email or phone
        required_fields = ['Customer', 'Address', 'Date', 'Service', 'Price']
        missing = [f for f in required_fields if not data.get(f)]
        email = data.get('Email', '').strip()
        phone = data.get('Number', '').strip()
        if not email and not phone:
            missing.append('Email or Phone')
        if missing:
            return jsonify({
                'success': False,
                'message': 'Missing required fields: ' + ', '.join(missing)
            }), 400

        # Read existing CSV to get fieldnames
        with open(CSV_FILE, 'r', encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        # Create new row with all fields (empty if not provided)
        new_row = {field: data.get(field, '') for field in fieldnames}

        # Append to CSV
        with open(CSV_FILE, 'a', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writerow(new_row)

        return jsonify({
            'success': True,
            'message': 'Customer added successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

## Remove app.run block for PythonAnywhere WSGI deployment
