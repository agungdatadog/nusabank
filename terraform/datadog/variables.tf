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

variable "on_call_emails" {
  type        = list(string)
  description = "Datadog users in the Application Support on-call rotation, in rotation order (weekly from 16 Nov 2026). They get real pages from every Nusa Bank monitor."
  default     = ["agung.nugroho@datadoghq.com", "daren.meisa@datadoghq.com"]
}

variable "channels_on_call_emails" {
  type        = list(string)
  description = "Datadog users in the Digital Channels on-call rotation, in rotation order (weekly from 16 Nov 2026). They get real pages."
  default     = ["agung.nugroho@datadoghq.com", "daren.meisa@datadoghq.com"]
}

variable "network_on_call_emails" {
  type        = list(string)
  description = "Datadog users in the Network on-call rotation, in rotation order (weekly from 16 Nov 2026). Reversed from Digital Channels so one person never holds both in the same week."
  default     = ["daren.meisa@datadoghq.com", "agung.nugroho@datadoghq.com"]
}
