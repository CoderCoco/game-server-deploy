FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir pipenv

COPY Pipfile Pipfile.lock* ./
RUN pipenv install --deploy --system

COPY app/ ./app/

WORKDIR /app/app

EXPOSE 5000

CMD ["python", "app.py"]
