# Cluster-level foundations only: namespaces, operators, and the Workload Identity KSA.
# Custom resources (DatadogAgent, Kafka, ExternalSecrets) live in k8s/ and are applied
# with kubectl — they need these CRDs to exist first, which a single plan can't express.

resource "kubernetes_namespace_v1" "nusabank" {
  metadata {
    name = "nusabank"
    labels = {
      app                         = "nusabank"
      "app.kubernetes.io/part-of" = "nusabank"
    }
  }
}

resource "kubernetes_namespace_v1" "operators" {
  for_each = toset(["datadog", "external-secrets", "strimzi"])

  metadata {
    name = each.value
    labels = {
      "app.kubernetes.io/part-of" = "nusabank-platform"
    }
  }
}

# External Secrets authenticates to Secret Manager as this KSA via Workload Identity.
resource "kubernetes_service_account_v1" "external_secrets" {
  metadata {
    name      = "external-secrets"
    namespace = kubernetes_namespace_v1.nusabank.metadata[0].name
    annotations = {
      "iam.gke.io/gcp-service-account" = var.secret_reader_gsa
    }
  }
}

resource "helm_release" "datadog_operator" {
  name       = "datadog-operator"
  repository = "https://helm.datadoghq.com"
  chart      = "datadog-operator"
  version    = var.datadog_operator_chart_version
  namespace  = kubernetes_namespace_v1.operators["datadog"].metadata[0].name

  # Credentials let the operator report its DatadogAgent config to Fleet Automation.
  # datadog-secret is synced from Secret Manager by k8s/platform/secrets.yaml.
  values = [yamlencode({
    site                 = "datadoghq.com"
    clusterName          = var.cluster_name
    apiKeyExistingSecret = "datadog-secret"
    appKeyExistingSecret = "datadog-secret"
    remoteConfiguration  = { enabled = true }
    resources = {
      requests = { cpu = "100m", memory = "256Mi" }
      limits   = { cpu = "500m", memory = "512Mi" }
    }
  })]
}

resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = var.external_secrets_chart_version
  namespace  = kubernetes_namespace_v1.operators["external-secrets"].metadata[0].name

  values = [yamlencode({
    installCRDs = true
    resources = {
      requests = { cpu = "50m", memory = "128Mi" }
      limits   = { cpu = "250m", memory = "256Mi" }
    }
  })]
}

resource "helm_release" "strimzi" {
  name       = "strimzi"
  repository = "https://strimzi.io/charts/"
  chart      = "strimzi-kafka-operator"
  version    = var.strimzi_chart_version
  namespace  = kubernetes_namespace_v1.operators["strimzi"].metadata[0].name

  values = [yamlencode({
    watchNamespaces = [kubernetes_namespace_v1.nusabank.metadata[0].name]
    resources = {
      requests = { cpu = "200m", memory = "384Mi" }
      limits   = { cpu = "1", memory = "512Mi" }
    }
  })]
}
