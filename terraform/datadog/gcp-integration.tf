# GCP integration for the whole shared project: Cloud SQL, GKE and load balancer
# metrics sit next to DBM and APM on the EP1 dashboards. Settings carried over from
# the previous (UI-configured) agung-service-account entry.
resource "datadog_integration_gcp_sts" "sandbox" {
  client_email                          = var.gcp_integration_sa
  automute                              = true
  resource_collection_enabled           = true
  is_per_project_quota_enabled          = true
  is_cspm_enabled                       = false
  is_security_command_center_enabled    = false
  is_resource_change_collection_enabled = false

  metric_namespace_configs {
    id       = "prometheus"
    disabled = true
    # The API echoes an empty list; omitting it trips a provider consistency check.
    filters = []
  }
}
