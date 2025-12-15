FROM alpine:3.20

WORKDIR /app

# Keep it simple and observable
RUN adduser -D appuser
USER appuser

CMD ["sh", "-lc", "echo '[dockerfile-service] built from Dockerfile'; echo '[dockerfile-service] PWD='$(pwd); echo '[dockerfile-service] env snapshot:'; env | sort; echo '[dockerfile-service] sleeping 1s'; sleep 1"]
