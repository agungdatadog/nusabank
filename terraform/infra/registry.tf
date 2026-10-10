resource "google_artifact_registry_repository" "nusabank" {
  location      = var.region
  repository_id = var.name_prefix
  format        = "DOCKER"
  description   = "Nusa Bank service images — pinned version tags only, never latest"

  docker_config {
    immutable_tags = true
  }
}

resource "google_artifact_registry_repository_iam_member" "gke_nodes_reader" {
  location   = google_artifact_registry_repository.nusabank.location
  repository = google_artifact_registry_repository.nusabank.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.gke_nodes.email}"
}
