output "namespaces" {
  value = concat(
    [kubernetes_namespace_v1.nusabank.metadata[0].name],
    [for ns in kubernetes_namespace_v1.operators : ns.metadata[0].name],
  )
}

output "next_step" {
  value = "kubectl apply -k k8s/platform && kubectl apply -k k8s/agent"
}
