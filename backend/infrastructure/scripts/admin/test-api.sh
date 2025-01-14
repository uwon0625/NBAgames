#!/bin/bash

BASE_URL="http://localhost:3001"

echo "Testing API endpoints..."

echo "\nTesting root endpoint"
curl -i $BASE_URL/

echo "\nTesting games endpoint"
curl -i $BASE_URL/api/games

echo "\nTesting cache endpoint"
curl -i $BASE_URL/api/games/cache

echo "\nTesting box score endpoint"
curl -i "$BASE_URL/api/games/0022300476/boxscore?status=scheduled" 