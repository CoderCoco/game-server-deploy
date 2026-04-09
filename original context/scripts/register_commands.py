"""
Register slash commands with Discord.

Run this once (or whenever you add new games) to update the commands.
Requires DISCORD_APP_ID and DISCORD_BOT_TOKEN environment variables.

Usage:
    export DISCORD_APP_ID="your-app-id"
    export DISCORD_BOT_TOKEN="your-bot-token"
    python register_commands.py
"""

import os
import requests

APP_ID = os.environ["DISCORD_APP_ID"]
BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
URL = f"https://discord.com/api/v10/applications/{APP_ID}/commands"

GAME_CHOICES = [
    {"name": "Palworld", "value": "palworld"},
    {"name": "Satisfactory", "value": "satisfactory"},
    # Add new games here — they'll show up as autocomplete options in Discord
]

COMMANDS = [
    {
        "name": "start",
        "description": "Start a game server",
        "options": [
            {
                "name": "game",
                "description": "Which game server to start",
                "type": 3,  # STRING
                "required": True,
                "choices": GAME_CHOICES,
            }
        ],
    },
    {
        "name": "stop",
        "description": "Stop a game server (saves are preserved)",
        "options": [
            {
                "name": "game",
                "description": "Which game server to stop",
                "type": 3,
                "required": True,
                "choices": GAME_CHOICES,
            }
        ],
    },
    {
        "name": "status",
        "description": "Check game server status (or list all if no game specified)",
        "options": [
            {
                "name": "game",
                "description": "Which game server to check (omit for all)",
                "type": 3,
                "required": False,
                "choices": GAME_CHOICES,
            }
        ],
    },
]

headers = {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

# Bulk overwrite global commands
resp = requests.put(URL, headers=headers, json=COMMANDS)

if resp.status_code == 200:
    print(f"Registered {len(COMMANDS)} commands successfully.")
    for cmd in resp.json():
        print(f"  /{cmd['name']}")
else:
    print(f"Error {resp.status_code}: {resp.text}")
