import Foundation
import Security

enum SyncCredentialsStore {
    private static let service = "app.nesti.sync"

    static func save(token: String, serverURL: String, homeID: UUID) throws {
        let account = key(serverURL: serverURL, homeID: homeID)
        let data = Data(token.utf8)
        SecItemDelete(query(account: account) as CFDictionary)
        var values = query(account: account)
        values[kSecValueData as String] = data
        values[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(values as CFDictionary, nil)
        guard status == errSecSuccess else { throw CredentialError(status: status) }
    }

    static func token(serverURL: String, homeID: UUID) throws -> String {
        var values = query(account: key(serverURL: serverURL, homeID: homeID))
        values[kSecReturnData as String] = true
        values[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(values as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            throw CredentialError(status: status)
        }
        return token
    }

    static func delete(serverURL: String, homeID: UUID) {
        SecItemDelete(query(account: key(serverURL: serverURL, homeID: homeID)) as CFDictionary)
    }

    private static func key(serverURL: String, homeID: UUID) -> String {
        "\(serverURL)|\(homeID.uuidString.lowercased())"
    }

    private static func query(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    struct CredentialError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "Could not access the sync credential (\(status))." }
    }
}
