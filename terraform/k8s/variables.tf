variable "project_id" {
  type    = string
  default = "datadog-ese-sandbox"
}

variable "region" {
  type    = string
  default = "asia-southeast2"
}

variable "cluster_name" {
  type    = string
  default = "indowebinar-gke"
}

variable "secret_reader_gsa" {
  type        = string
  description = "GSA from terraform/infra output secret_reader_gsa"
  default     = "indowebinar-secret-reader@datadog-ese-sandbox.iam.gserviceaccount.com"
}

# Chart versions pinned; each was released at least two weeks before adoption.
variable "datadog_operator_chart_version" {
  type    = string
  default = "2.27.0"
}

variable "external_secrets_chart_version" {
  type    = string
  default = "2.11.0"
}

variable "strimzi_chart_version" {
  type    = string
  default = "1.2.0"
}
