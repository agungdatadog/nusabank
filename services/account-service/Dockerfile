# Build context is the repo root (tools/build/cloudbuild.yaml) so the shared seed is reachable.
FROM maven:3.9.16-eclipse-temurin-21-noble AS build
WORKDIR /src
COPY services/account-service/pom.xml ./
RUN mvn -q -B dependency:go-offline
COPY services/account-service/src ./src
RUN mvn -q -B package

# No dd-java-agent here: Single Step Instrumentation injects it at pod start.
FROM eclipse-temurin:21.0.12_8-jre-noble
WORKDIR /app
COPY --from=build /src/target/account-service.jar ./account-service.jar
COPY catalog/seed/customers.json ./seed/customers.json
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/account-service.jar"]
