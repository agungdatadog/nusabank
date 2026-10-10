variable "project_id" {
  type    = string
  default = "datadog-ese-sandbox"
}

variable "gcp_integration_sa" {
  type        = string
  description = "terraform/infra output datadog_integration_sa"
  default     = "indowebinar-dd-integration@datadog-ese-sandbox.iam.gserviceaccount.com"
}
