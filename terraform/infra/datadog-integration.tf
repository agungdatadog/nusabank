# Service account the Datadog GCP integration impersonates (keyless, via STS).
# Replaces agung-service-account, which was deleted outside Terraform and broke the integration.
resource "google_service_account" "datadog_integration" {
  account_id   = "${var.name_prefix}-dd-integration"
  display_name = "Datadog GCP integration"
  description  = "Impersonated by Datadog to collect metrics and resources. Managed in nusabank/terraform/infra."
}

# Roles from Datadog's GCP integration guide. Additive bindings only — shared project.
resource "google_project_iam_member" "datadog_integration" {
  for_each = toset([
    "roles/compute.viewer",
    "roles/monitoring.viewer",
    "roles/cloudasset.viewer",
    "roles/browser",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.datadog_integration.email}"
}

# Lets the org's Datadog STS principal mint tokens for the account above.
resource "google_service_account_iam_member" "datadog_delegate" {
  service_account_id = google_service_account.datadog_integration.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.datadog_sts_delegate}"
}

variable "datadog_sts_delegate" {
  type        = string
  description = "Datadog org's STS delegate (GET /api/v2/integration/gcp/sts_delegate)"
  default     = "ddgci-1ccc95656c6c01b303f6@datadog-gci-sts-us1-prod.iam.gserviceaccount.com"
}

output "datadog_integration_sa" {
  value = google_service_account.datadog_integration.email
}
