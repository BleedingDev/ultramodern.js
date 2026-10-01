/// <reference types="node" />
import os from 'node:os';

declare const MAC_RE: RegExp;
declare const MAC_IP_RE: RegExp;
interface Address {
    ip?: string;
    ipv6?: string;
    mac?: string;
}
type AddressCallback = (err: Error | null, addr: Address) => void;
type MacCallback = (err?: Error | null, addr?: string | null) => void;
type DnsCallback = (err?: Error | null, servers?: string[]) => void;
declare function getInterfaceAddress(family?: string, name?: string): os.NetworkInterfaceInfo | undefined;
/**
 * Get current machine IPv4
 *
 * interfaceName: interface name, default is 'eth' on linux, 'en' on mac os.
 */
declare function ip(interfaceName?: string): string | undefined;
/**
 * Get current machine IPv6
 *
 * interfaceName: interface name, default is 'eth' on linux, 'en' on mac os.
 */
declare function ipv6(interfaceName?: string): string | undefined;
/**
 * Get current machine MAC address
 *
 * interfaceName: name, default is 'eth' on linux, 'en' on mac os.
 */
declare function mac(callback: MacCallback): void;
declare function mac(interfaceName: string, callback: MacCallback): void;
/**
 * Get DNS servers.
 *
 * filepath: resolv config file path. default is '/etc/resolv.conf'.
 */
declare function dns(callback: DnsCallback): void;
declare function dns(filepath: string, callback: DnsCallback): void;
/**
 * Get all addresses.
 *
 * interfaceName: interface name, default is 'eth' on linux, 'en' on mac os.
 */
declare function address(callback: AddressCallback): void;
declare function address(interfaceName: string, callback: AddressCallback): void;

export { MAC_IP_RE, MAC_RE, address, address as default, dns, getInterfaceAddress, ip, ipv6, mac };
export type { Address, AddressCallback, DnsCallback, MacCallback };
