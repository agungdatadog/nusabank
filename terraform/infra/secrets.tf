# Generated DB credentials go to Secret Manager; workloads read them via External
# Secrets, so no password ever lands in a manifest.
resource "google_secret_manager_secret" "db_service" {
  for_each = local.service_databases

  secret_id = "${var.name_prefix}-db-${each.key}-password"
  labels    = { app = "nusabank" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_service" {
  for_each = local.service_databases

  secret      = google_secret_manager_secret.db_service[each.key].id
  secret_data = random_password.service[each.key].result
}

resource "google_secret_manager_secret" "db_datadog" {
  for_each = local.sql_instances

  secret_id = "${var.name_prefix}-db-${each.key}-datadog-password"
  labels    = { app = "nusabank" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_datadog" {
  for_each = local.sql_instances

  secret      = google_secret_manager_secret.db_datadog[each.key].id
  secret_data = random_password.datadog[each.key].result
}

resource "google_secret_manager_secret" "db_admin" {
  for_each = local.sql_instances

  secret_id = "${var.name_prefix}-db-${each.key}-admin-password"
  labels    = { app = "nusabank" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_admin" {
  for_each = local.sql_instances

  secret      = google_secret_manager_secret.db_admin[each.key].id
  secret_data = random_password.dbadmin[each.key].result
}

# In-cluster stores (MongoDB for chat-service, Redis for cache and agent memory).
resource "random_password" "platform" {
  for_each = toset(["mongodb-root", "redis"])

  length  = 32
  special = false
}

resource "google_secret_manager_secret" "platform" {
  for_each = random_password.platform

  secret_id = "${var.name_prefix}-${each.key}-password"
  labels    = { app = "nusabank" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "platform" {
  for_each = random_password.platform

  secret      = google_secret_manager_secret.platform[each.key].id
  secret_data = each.value.result
}

# Shared login for the synthetic customers in catalog/seed/customers.json, and the
# OTP the simulated SMS gateway "sends". Read them here to log in during a demo.
resource "random_password" "demo_customer" {
  length  = 14
  special = false
}

resource "random_password" "demo_otp" {
  length  = 6
  upper   = false
  lower   = false
  special = false
}

locals {
  demo_secrets = {
    "demo-customer-password" = random_password.demo_customer.result
    "demo-mfa-otp"           = random_password.demo_otp.result
  }
}

resource "google_secret_manager_secret" "demo" {
  for_each = local.demo_secrets

  secret_id = "${var.name_prefix}-${each.key}"
  labels    = { app = "nusabank" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "demo" {
  for_each = local.demo_secrets

  secret      = google_secret_manager_secret.demo[each.key].id
  secret_data = each.value
}

# Secrets created by hand (API keys, RUM, JWT). Values never live in Terraform.
locals {
  manual_secret_ids = [
    "${var.name_prefix}-dd-api-key",
    "${var.name_prefix}-dd-app-key",
    "${var.name_prefix}-anthropic-api-key",
    "${var.name_prefix}-rum-application-id",
    "${var.name_prefix}-rum-client-token",
    "${var.name_prefix}-rum-remote-config-id",
    "${var.name_prefix}-jwt-secret",
  ]

  all_secret_ids = concat(
    local.manual_secret_ids,
    [for s in google_secret_manager_secret.db_service : s.secret_id],
    [for s in google_secret_manager_secret.db_datadog : s.secret_id],
    [for s in google_secret_manager_secret.db_admin : s.secret_id],
    [for s in google_secret_manager_secret.platform : s.secret_id],
    [for k in keys(local.demo_secrets) : "${var.name_prefix}-${k}"],
  )
}

# Workload Identity: the External Secrets KSA in namespace nusabank acts as this GSA.
resource "google_service_account" "secret_reader" {
  account_id   = "${var.name_prefix}-secret-reader"
  display_name = "Nusa Bank External Secrets reader"
}

resource "google_service_account_iam_member" "secret_reader_wi" {
  service_account_id = google_service_account.secret_reader.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[nusabank/external-secrets]"

  # The workload pool only exists once the cluster does.
  depends_on = [google_container_cluster.nusabank]
}

resource "google_secret_manager_secret_iam_member" "secret_reader" {
  for_each = toset(local.all_secret_ids)

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.secret_reader.email}"

  depends_on = [
    google_secret_manager_secret.db_service,
    google_secret_manager_secret.db_datadog,
    google_secret_manager_secret.db_admin,
    google_secret_manager_secret.platform,
    google_secret_manager_secret.demo,
  ]
}
