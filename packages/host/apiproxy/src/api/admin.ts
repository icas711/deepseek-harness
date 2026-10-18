/**
 * admin domain contract: user and device management over the web-auth
 * plugin's user store (the deployment's login-password accounts). Every
 * method except `status` requires the calling web user to hold the `admin`
 * role — the host enforces it, so a rejected call carries a typed
 * `admin-forbidden` error rather than an empty result. No view carries
 * secret material: a user view names the role and creation time; a device
 * view names its own session id (the revoke target the UI already holds)
 * plus its live window.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Role of a managed account. Admins see every cabinet and run this domain. */
export type AdminRole = 'admin' | 'user'

/** Wire view of one managed account. */
export interface AdminUserView {
  /** The login (also the cabinet directory name). */
  login: string
  /** Whether the account runs the admin domain and sees every cabinet. */
  role: AdminRole
  /** When the account was created (seed or `admin.createUser`). */
  createdAt: number
}

/** Wire view of one live session of a managed account (a "device"). */
export interface AdminDeviceView {
  /** The server-side session id — the revoke target. */
  sessionId: string
  /** When the session was minted. */
  issuedAt: number
  /** When the session stops authenticating. */
  expiresAt: number
  /** When the session last authenticated a request. */
  lastSeenAt: number
}

/** admin domain unary methods (the map keys admin.* of RpcMethodMap). */
export interface AdminApi {
  /**
   * The calling web user's admin flag. Served to every authenticated caller
   * (it discloses only what the caller already is): the client hides the
   * administration page for non-admins, while every data method below
   * re-checks the role on the host.
   */
  status(request: RpcRequest<{}>): Promise<RpcResponse<{ admin: boolean }>>

  /** List every managed account, ordered by login. */
  listUsers(request: RpcRequest<{}>): Promise<RpcResponse<{ users: AdminUserView[] }>>

  /**
   * Create an account: the host hashes the password (scrypt) and persists
   * the record. The login must match the login charset; the password must
   * carry at least 8 characters.
   */
  createUser(request: RpcRequest<{ login: string; password: string; role: AdminRole }>): Promise<RpcResponse<{}>>

  /**
   * Delete an account and revoke all its sessions. The last admin cannot be
   * deleted (`admin-last-admin`): the deployment would lose the ability to
   * administer itself.
   */
  deleteUser(request: RpcRequest<{ login: string }>): Promise<RpcResponse<{}>>

  /**
   * Replace one account's password with a fresh host-side hash and revoke
   * every session of that login — a reset is a lockout of all devices, the
   * new password is the only way back in. The caller generates and shows the
   * new password; the host stores only its hash.
   */
  resetPassword(request: RpcRequest<{ login: string; newPassword: string }>): Promise<RpcResponse<{}>>

  /**
   * Change one account's role. Demoting the last admin answers
   * `admin-last-admin`. The change takes effect immediately: the admin
   * flag is read from the store on every request.
   */
  setRole(request: RpcRequest<{ login: string; role: AdminRole }>): Promise<RpcResponse<{}>>

  /** List one account's live (unexpired) sessions, oldest issuance first. */
  listDevices(request: RpcRequest<{ login: string }>): Promise<RpcResponse<{ devices: AdminDeviceView[] }>>

  /** Revoke one session of one account. An unknown id answers `admin-device-not-found`. */
  revokeDevice(request: RpcRequest<{ login: string; sessionId: string }>): Promise<RpcResponse<{}>>

  /** Revoke every session of one account; returns how many were revoked. */
  revokeAllDevices(request: RpcRequest<{ login: string }>): Promise<RpcResponse<{ revoked: number }>>
}
