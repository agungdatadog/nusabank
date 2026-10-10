variable "project_id" {
  type    = string
  default = "datadog-ese-sandbox"
}

variable "gcp_integration_sa" {
  type        = string
  description = "terraform/infra output datadog_integration_sa"
  default     = "indowebinar-dd-integration@datadog-ese-sandbox.iam.gserviceaccount.com"
}

variable "gce_instance_filters" {
  type        = list(string)
  description = "GCE label filters (key:value). A VM is imported when it matches any one of them."
  default = [
    "group:indowebinar",                    # Nusa Bank, every indowebinar-* resource
    "goog-k8s-cluster-name:agung-gke-demo", # earlier personal demo cluster
    "owner:agung",                          # personal VMs, labelled by hand 2026-10-10
    "owner:anbdi",
  ]
}
