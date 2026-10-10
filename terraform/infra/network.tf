# Dedicated VPC: the project's default network is shared by many other demos.
resource "google_compute_network" "nusabank" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "jakarta" {
  name                     = "${var.name_prefix}-jkt"
  network                  = google_compute_network.nusabank.id
  region                   = var.region
  ip_cidr_range            = var.cidr_nodes
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.cidr_pods
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.cidr_services
  }
}

# Private nodes still need egress: Datadog intake, Claude API, image pulls.
resource "google_compute_router" "nusabank" {
  name    = "${var.name_prefix}-router"
  network = google_compute_network.nusabank.id
  region  = var.region
}

resource "google_compute_router_nat" "nusabank" {
  name                               = "${var.name_prefix}-nat"
  router                             = google_compute_router.nusabank.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# Private Service Access, so Cloud SQL gets private IPs only.
resource "google_compute_global_address" "psa" {
  name          = "${var.name_prefix}-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.psa_range_address
  prefix_length = 20
  network       = google_compute_network.nusabank.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.nusabank.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
}

resource "google_compute_global_address" "frontend" {
  name        = "${var.name_prefix}-frontend-ip"
  description = "Static IP for the frontend Ingress"
}
