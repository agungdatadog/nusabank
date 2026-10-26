resource "google_service_account" "gke_nodes" {
  account_id   = "${var.name_prefix}-gke-nodes"
  display_name = "Nusa Bank GKE nodes"
}

# Additive bindings only — this project is shared, never manage its full IAM policy.
resource "google_project_iam_member" "gke_nodes" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

# GKE Standard, not Autopilot: CNM and USM need agent privileges Autopilot restricts.
resource "google_container_cluster" "nusabank" {
  name     = "${var.name_prefix}-gke"
  location = var.region

  # Traffic history is the scarcest resource; an accidental destroy would cost days.
  deletion_protection = true

  network    = google_compute_network.nusabank.id
  subnetwork = google_compute_subnetwork.jakarta.id

  remove_default_node_pool = true
  initial_node_count       = 1

  release_channel {
    channel = "REGULAR"
  }

  # A node upgrade reschedules every pod; pods created before the Datadog admission webhook
  # is back run without the tracer (2026-10-11 and 2026-10-23). No node or minor upgrades
  # during the webinar series; control-plane patches still apply, in a quiet WIB window.
  maintenance_policy {
    recurring_window {
      start_time = "2026-10-25T19:00:00Z" # Monday 02:00 WIB
      end_time   = "2026-10-25T23:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SU"
    }
    maintenance_exclusion {
      exclusion_name = "${var.name_prefix}-webinar-series"
      start_time     = "2026-10-26T00:00:00Z"
      end_time       = "2026-12-31T23:59:59Z"
      exclusion_options {
        scope = "NO_MINOR_OR_NODE_UPGRADES"
      }
    }
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.cidr_master
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Enforces the cluster-only rule for /internal/* paths.
  network_policy {
    enabled  = true
    provider = "CALICO"
  }

  addons_config {
    network_policy_config {
      disabled = false
    }
  }

  # Observability goes to Datadog; keep only GKE system components in Cloud Ops.
  logging_config {
    enable_components = ["SYSTEM_COMPONENTS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = false
    }
  }

  resource_labels = {
    app = "nusabank"
    env = var.env
  }
}

resource "google_container_node_pool" "primary" {
  name           = "primary"
  location       = var.region
  cluster        = google_container_cluster.nusabank.name
  node_locations = var.node_locations
  node_count     = var.node_count_per_zone

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type    = var.node_machine_type
    disk_size_gb    = 100
    disk_type       = "pd-balanced"
    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    # Container SBOM collection is incompatible with GKE Image Streaming.
    gcfs_config {
      enabled = false
    }

    labels = {
      app = "nusabank"
      env = var.env
    }
  }
}
