import Foundation

struct SyncTransport {
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    func discovery(serverURL: URL) async throws -> SyncDiscovery {
        try await send(serverURL: serverURL, path: "discovery", method: "GET", token: nil, body: Optional<Data>.none)
    }

    func pair(serverURL: URL, code: String, deviceName: String) async throws -> SyncPairResponse {
        struct Body: Encodable { let code: String; let deviceName: String }
        return try await send(serverURL: serverURL, path: "pair", method: "POST", token: nil, body: encoder.encode(Body(code: code, deviceName: deviceName)))
    }

    func enroll(serverURL: URL, homeName: String, deviceName: String) async throws -> SyncPairResponse {
        struct Body: Encodable { let homeName: String; let deviceName: String }
        return try await send(serverURL: serverURL, path: "enroll", method: "POST", token: nil, body: encoder.encode(Body(homeName: homeName, deviceName: deviceName)))
    }

    func sync(serverURL: URL, token: String, request: SyncRequest) async throws -> SyncResponse {
        try await send(serverURL: serverURL, path: "sync", method: "POST", token: token, body: encoder.encode(request))
    }

    func revoke(serverURL: URL, token: String) async throws {
        let _: EmptyResponse = try await send(serverURL: serverURL, path: "devices/current", method: "DELETE", token: token, body: Optional<Data>.none)
    }

    private func send<Response: Decodable>(serverURL: URL, path: String, method: String, token: String?, body: Data?) async throws -> Response {
        var api = serverURL
            .appendingPathComponent("api")
            .appendingPathComponent("sync")
            .appendingPathComponent("v1")
        for component in path.split(separator: "/") { api.appendPathComponent(String(component)) }
        var request = URLRequest(url: api)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw TransportError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? decoder.decode(ErrorEnvelope.self, from: data)
            throw TransportError.server(envelope?.error.message ?? "The sync server returned \(http.statusCode).")
        }
        if Response.self == EmptyResponse.self { return EmptyResponse() as! Response }
        return try decoder.decode(Response.self, from: data)
    }

    private struct ErrorEnvelope: Decodable { struct Value: Decodable { let message: String }; let error: Value }
    private struct EmptyResponse: Codable { init() {} }

    enum TransportError: LocalizedError {
        case invalidResponse
        case server(String)
        var errorDescription: String? {
            switch self {
            case .invalidResponse: "The sync server returned an invalid response."
            case let .server(message): message
            }
        }
    }
}
