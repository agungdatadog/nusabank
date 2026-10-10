variable "project_id" {
  type        = string
  description = "GCP project ID"
  default     = "datadog-ese-sandbox"
}

variable "region" {
  type        = string
  description = "GCP region — Jakarta, so RUM latency matches an Indonesian audience"
  default     = "asia-southeast2"
}

variable "env" {
  type        = string
  description = "Datadog env tag value"
  default     = "demo"
}

variable "node_locations" {
  type        = list(string)
  description = "Zones for the primary node pool"
  default     = ["asia-southeast2-a", "asia-southeast2-b"]
}

variable "node_count_per_zone" {
  type        = number
  description = "Nodes per zone. Fixed rather than autoscaled so the baseline stays predictable."
  default     = 2
}

variable "node_machine_type" {
  type    = string
  default = "e2-standard-4"
}

variable "sql_tier" {
  type        = string
  description = "Cloud SQL machine tier, same for all three instances"
  default     = "db-custom-1-3840"
}

# CIDRs chosen to avoid every range already allocated in the shared project.
variable "cidr_nodes" {
  type    = string
  default = "10.60.0.0/20"
}

variable "cidr_pods" {
  type    = string
  default = "10.64.0.0/14"
}

variable "cidr_services" {
  type    = string
  default = "10.68.0.0/20"
}

variable "cidr_master" {
  type    = string
  default = "172.16.60.0/28"
}

variable "psa_range_address" {
  type        = string
  description = "Private Service Access range for Cloud SQL private IPs (/20)"
  default     = "10.70.0.0"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for every GCP object name — the project is shared with other teams"
  default     = "indowebinar"
}
