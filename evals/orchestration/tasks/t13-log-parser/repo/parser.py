import json
import sys

def parse_logs(log_path, output_path):
    errors = []
    
    # Bug: opens with strict utf-8 encoding (will crash on binary/invalid bytes)
    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if 'ERROR' in line:
                # Bug: crashes if the line is truncated/lacks spaces
                parts = line.split(' ', 3)
                date = parts[0]
                time = parts[1]
                level = parts[2]
                message = parts[3]
                
                errors.append({
                    'timestamp': f"{date} {time}",
                    'message': message
                })

    with open(output_path, 'w') as f:
        json.dump(errors, f, indent=2)

if __name__ == '__main__':
    # Bug: does not output summary.json or track failures
    parse_logs('logs.txt', 'errors.json')
