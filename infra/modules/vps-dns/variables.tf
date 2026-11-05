variable "zone_id" {
  description = "Zone the records are published in."
  type        = string
}

variable "zone_name" {
  description = "Apex of that zone. An entry of \"@\" becomes this name itself."
  type        = string
}

variable "ipv4" {
  description = "Public address of the machine every one of these names answers at."
  type        = string

  validation {
    condition     = can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}$", var.ipv4))
    error_message = "The address has to be a plain IPv4 of the machine."
  }
}

variable "hostnames" {
  description = "Every name the proxy on that machine answers on, and whether Cloudflare stands in front of it."
  type = map(object({
    proxied = bool
  }))

  validation {
    condition     = length(var.hostnames) > 0
    error_message = "A machine nobody can reach by name is not a deployment; name at least one host."
  }

  validation {
    condition = alltrue([
      for host in keys(var.hostnames) : host == "@" || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", host))
    ])
    error_message = "A host is \"@\" for the apex, or one lowercase label with no dot in it."
  }
}
