# Use an official Python runtime
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
# UPDATED: Added timeout cushion and forced CPU-only PyTorch downloads
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Copy the application code
COPY . .

# Expose the FastAPI port
EXPOSE 8000

# Run the server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]