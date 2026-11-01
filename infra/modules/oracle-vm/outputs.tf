output "instance_id" {
  description = "OCID of the instance."
  value       = oci_core_instance.this.id
}

output "private_ip" {
  description = "Address inside the VCN. There is no inbound rule to reach it on."
  value       = oci_core_instance.this.private_ip
}

output "public_ip" {
  description = "Address the tunnel dials out from. Nothing listens on it."
  value       = oci_core_instance.this.public_ip
}

output "image_id" {
  description = "Image the instance was built from, so a rebuild can be pinned to it."
  value       = data.oci_core_images.ubuntu.images[0].id
}
