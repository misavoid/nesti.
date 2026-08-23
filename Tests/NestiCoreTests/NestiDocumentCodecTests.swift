import Foundation
import XCTest
@testable import NestiCore

final class NestiDocumentCodecTests: XCTestCase {
    func testRoundTripPreservesPlan() throws {
        let task = TaskRecord(
            name: "Clean toilet",
            estimatedMinutes: 5,
            schedule: .interval(days: 4, basis: .completion),
            reminder: ReminderRecord(enabled: true, hour: 9, minute: 30)
        )
        let document = NestiDocument(name: "My Home", rooms: [RoomRecord(name: "Bathroom", tasks: [task])])

        let data = try NestiDocumentCodec.encode(document)
        let decoded = try NestiDocumentCodec.decode(data)

        XCTAssertEqual(decoded.id, document.id)
        XCTAssertEqual(decoded.name, document.name)
        XCTAssertEqual(decoded.rooms, document.rooms)
        XCTAssertEqual(decoded.exportedAt.timeIntervalSince1970, document.exportedAt.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("\"version\" : 1"))
    }

    func testRejectsUnsupportedVersion() throws {
        var document = NestiDocument(name: "Home", rooms: [RoomRecord(name: "Kitchen")])
        document.version = 99
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(document)

        XCTAssertThrowsError(try NestiDocumentCodec.decode(data)) { error in
            XCTAssertEqual(error as? NestiDocumentError, .unsupportedVersion(99))
        }
    }

    func testReportsSemanticValidation() {
        let document = NestiDocument(name: "", rooms: [
            RoomRecord(name: "Bathroom", tasks: [
                TaskRecord(name: "", estimatedMinutes: 0, schedule: .weekdays([]))
            ])
        ])

        let issues = NestiDocumentValidator.issues(in: document)
        XCTAssertEqual(issues.count, 4)
    }

    func testDecodesBriefExampleWithDefaultIntervalBasis() throws {
        let json = """
        {
          "version": 1,
          "name": "My Home",
          "rooms": [{
            "name": "Bathroom",
            "tasks": [{
              "name": "Clean toilet",
              "schedule": { "type": "interval", "days": 4 },
              "estimatedMinutes": 5
            }]
          }]
        }
        """

        let document = try NestiDocumentCodec.decode(Data(json.utf8))
        XCTAssertEqual(document.rooms.first?.tasks.first?.schedule, .interval(days: 4, basis: .completion))
    }

    func testDecodesGeneratedMonthlyInterval() throws {
        let json = """
        {"version":1,"name":"Home","rooms":[{"name":"Bath","tasks":[
          {"name":"Clean heater","schedule":{"type":"monthly","intervalMonths":6}}
        ]}]}
        """

        let document = try NestiDocumentCodec.decode(Data(json.utf8))
        XCTAssertEqual(
            document.rooms.first?.tasks.first?.schedule,
            .monthly(day: nil, intervalMonths: 6, basis: .completion)
        )
    }

    func testMalformedFileReportsJSONPath() {
        let json = """
        {"version":1,"name":"Home","rooms":[{"name":"Bath","tasks":[{}]}]}
        """

        XCTAssertThrowsError(try NestiDocumentCodec.decode(Data(json.utf8))) { error in
            XCTAssertTrue(error.localizedDescription.contains("$.rooms[0].tasks[0].name"))
        }
    }
}
