output "gke_cluster_name" {
  value = google_container_cluster.nusabank.name
}

output "gke_cluster_endpoint" {
  value     = google_container_cluster.nusabank.endpoint
  sensitive = true
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.nusabank.repository_id}"
}

output "frontend_ip" {
  value = google_compute_global_address.frontend.address
}

output "cloudsql_private_ips" {
  description = "Private IP per instance, for service DB hosts and DBM checks"
  value       = { for k, v in google_sql_database_instance.nusabank : k => v.private_ip_address }
}

output "service_database_instance" {
  description = "Which instance each service database lives on"
  value       = { for db, cfg in local.service_databases : db => "${var.name_prefix}-${cfg.instance}" }
}

output "secret_reader_gsa" {
  value = google_service_account.secret_reader.email
}
