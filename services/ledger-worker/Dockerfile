# Build context is the repo root (tools/build/cloudbuild.yaml).
FROM maven:3.9.16-eclipse-temurin-21-noble AS build
WORKDIR /src
COPY services/ledger-worker/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY services/ledger-worker/src ./src
RUN mvn -q -B package

# No dd-java-agent here: Single Step Instrumentation injects it at pod start.
FROM eclipse-temurin:21.0.12_8-jre-noble
WORKDIR /app
COPY --from=build /src/target/ledger-worker.jar ./ledger-worker.jar
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/ledger-worker.jar"]
