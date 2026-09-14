import requests
import sys

def check_status():
    try:
        response = requests.get("http://localhost:8000/health/runtime")
        if response.status_code == 200:
            print("Omnix Runtime Status:")
            for key, value in response.json().items():
                print(f"  {key}: {value}")
        else:
            print(f"Error: Received status code {response.status_code}")
    except Exception as e:
        print(f"Error connecting to runtime: {e}")

if __name__ == "__main__":
    check_status()
