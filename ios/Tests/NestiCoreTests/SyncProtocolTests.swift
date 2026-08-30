import Foundation
import XCTest
@testable import NestiCore

final class SyncProtocolTests: XCTestCase {
    func testProfileMutationUsesDirectProtocolPayload() throws {
        let mutation = SyncMutation(
            id: UUID(uuidString: "87ad8dc0-00a0-4d9e-9a6f-bb19d5f88d15")!,
            entityType: .profile,
            entityId: UUID(uuidString: "13a82f7a-2029-4e13-8a5d-40ea958dba88")!,
            operation: .upsert,
            baseRevision: "0",
            payload: SyncPayload(name: "Alex", color: "#147d64", sortOrder: 0)
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(SyncRequest(cursor: "1", mutations: [mutation]))) as? [String: Any])
        let mutations = try XCTUnwrap(object["mutations"] as? [[String: Any]])
        let payload = try XCTUnwrap(mutations.first?["payload"] as? [String: Any])
        XCTAssertEqual(object["protocolVersion"] as? Int, 1)
        XCTAssertEqual(mutations.first?["entityType"] as? String, "profile")
        XCTAssertEqual(payload["name"] as? String, "Alex")
        XCTAssertEqual(payload["color"] as? String, "#147d64")
    }

    func testSnapshotDecodesProfileAttributedCompletion() throws {
        let json = """
        {
          "protocolVersion": 1,
          "cursor": "4",
          "home": {"id":"421c47d7-91a1-4ea9-a70b-7dbe85ed149e","revision":"1","payload":{"name":"Home"}},
          "profiles": [{"id":"13a82f7a-2029-4e13-8a5d-40ea958dba88","revision":"2","payload":{"name":"Alex","color":"#147d64","sortOrder":0}}],
          "rooms": [],
          "tasks": [],
          "completions": [{"id":"c86c28e1-f104-49a0-b780-5daec591b794","revision":"4","payload":{"taskId":"87ad8dc0-00a0-4d9e-9a6f-bb19d5f88d15","profileId":"13a82f7a-2029-4e13-8a5d-40ea958dba88","completedAt":"2026-08-30T12:00:00Z"}}]
        }
        """
        let snapshot = try JSONDecoder().decode(SyncSnapshot.self, from: Data(json.utf8))
        XCTAssertEqual(snapshot.profiles.first?.payload.name, "Alex")
        XCTAssertEqual(snapshot.completions.first?.payload.profileId?.uuidString.lowercased(), "13a82f7a-2029-4e13-8a5d-40ea958dba88")
    }

    func testMutationOrderingPutsParentsBeforeChildrenAndChildDeletesFirst() {
        XCTAssertLessThan(
            syncMutationApplicationPriority(entityType: .room, operation: .upsert),
            syncMutationApplicationPriority(entityType: .task, operation: .upsert)
        )
        XCTAssertLessThan(
            syncMutationApplicationPriority(entityType: .completion, operation: .delete),
            syncMutationApplicationPriority(entityType: .task, operation: .delete)
        )
        XCTAssertLessThan(
            syncMutationApplicationPriority(entityType: .completion, operation: .upsert),
            syncMutationApplicationPriority(entityType: .completion, operation: .delete)
        )
    }
}
