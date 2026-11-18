import { describe, it, expect } from 'vitest';
import { buildFromScratchService } from '../buildFromScratchService';
import { DEFAULT_CHECKPOINTS } from '../eventConfigService';

describe('Real-World Student Repository Evaluation — Hostel-Allocation', () => {
  it('correctly analyzes a standalone Java hackathon repository matching Hostel-Allocation', () => {
    const studentFiles = [
      {
        filename: 'README.md',
        content: `# Hostel Room and Bed Allocation System
A robust, Java-based Hostel Allocation Management System designed for college dormitories.
## 1. Problem Statement & Mission Blueprint
Colleges face significant logistical challenges during annual student hostel allotment.
## 2. Key Modules & Architecture Design
Student Entities (Student2, Boy, Girl), Bed Matrix Allocation Engine, Domain Exception Hierarchy.
## 3. Setup and Execution Instructions
javac -d . Hostel_allocate.java
java P1.Hostel_allocate
## 4. Testing & Verification Instructions
javac -d . TestHostelAllocate.java
java P1.TestHostelAllocate
`,
      },
      {
        filename: 'Hostel_allocate.java',
        content: `package P1;
import java.util.Scanner;
import java.io.*;

class Student2 { String name; }
class Boy extends Student2 { int id; int type; int bed; boolean joined; }
class Girl extends Student2 { int id; int type; int bed; boolean joined; }

public class Hostel_allocate {
    static Scanner sc = new Scanner(System.in);
    static Boy[] boy = new Boy[30];
    static Girl[] girl = new Girl[30];
    public static void main(String[] args) {
        System.out.println("Hostel Allotment");
        try {
            join();
        } catch (Exception e) {
            System.out.println(e.getMessage());
        }
    }
    static void join() throws Exception {
        try {
            File f = new File("students.txt");
            BufferedWriter bw = new BufferedWriter(new FileWriter(f, true));
            bw.close();
        } catch (Exception e) {}
    }
}
class InvalidGenderException extends Exception { public InvalidGenderException(String m) { super(m); } }
class HostelFullException extends Exception { public HostelFullException(String m) { super(m); } }
`,
      },
      {
        filename: 'TestHostelAllocate.java',
        content: `package P1;
public class TestHostelAllocate {
    public static void main(String[] args) {
        testExceptions();
        testBedMatrixDimensions();
    }
    static void testExceptions() {
        InvalidGenderException ex = new InvalidGenderException("err");
        assert ex.getMessage() != null;
    }
    static void testBedMatrixDimensions() {
        assert 3 * 5 == 15;
    }
}
`,
      },
      {
        filename: 'run.bat',
        content: `@echo off\njavac -d . Hostel_allocate.java TestHostelAllocate.java\njava P1.TestHostelAllocate\n`,
      },
      {
        filename: '.gitignore',
        content: `*.class\nP1/\nstudents.txt\n`,
      },
    ];

    const studentCommits = [
      {
        sha: 'd887e1b',
        message: 'feat(integration): add simulated bed matrix integration and disallocation lifecycle assertions',
        author: 'SK-Sathyavada-008',
      },
      {
        sha: '2178d3d',
        message: 'test(verification): introduce automated regression test suite covering domain exceptions and bed matrix boundaries',
        author: 'SK-Sathyavada-008',
      },
      {
        sha: 'dc25b68',
        message: 'build(tooling): add compilation and execution automation script with gitignore',
        author: 'SK-Sathyavada-008',
      },
      {
        sha: '42a139c',
        message: 'docs(blueprint): add comprehensive system blueprint, architecture, and setup instructions',
        author: 'SK-Sathyavada-008',
      },
      {
        sha: 'ae93201',
        message: 'Add files via upload',
        author: 'SK-Sathyavada-008',
      },
      {
        sha: 'a463efe',
        message: 'Initial commit',
        author: 'SK-Sathyavada-008',
      },
    ];

    // 1. Language and Build Tooling Detection
    const buildReport = buildFromScratchService.analyzeBuildAndTesting(studentFiles);
    expect(buildReport.detectedLanguage).toBe('Java');
    expect(buildReport.detectedBuildCommands.length).toBeGreaterThan(0);
    expect(buildReport.hasTestCases).toBe(true);
    expect(buildReport.testFiles).toContain('TestHostelAllocate.java');

    // 2. Documentation Evaluation
    const docReport = buildFromScratchService.analyzeDocumentation(studentFiles);
    expect(docReport.hasReadme).toBe(true);
    expect(docReport.setupInstructionsPresent).toBe(true);
    expect(docReport.architectureDocumented).toBe(true);
    expect(docReport.testInstructionsPresent).toBe(true);
    expect(docReport.score).toBeGreaterThanOrEqual(90);

    // 3. Code Quality Evaluation
    const qualityReport = buildFromScratchService.analyzeCodeQuality(studentFiles);
    expect(qualityReport.score).toBeGreaterThanOrEqual(80);
    expect(qualityReport.errorHandlingNotes).toMatch(/error handling blocks found/i);

    // 4. Milestone Checkpoint Analysis
    const checkpoints = buildFromScratchService.analyzeCheckpoints(
      DEFAULT_CHECKPOINTS,
      studentFiles,
      studentCommits
    );

    const bp = checkpoints.find((c) => c.checkpointId === 'blueprint')!;
    const core = checkpoints.find((c) => c.checkpointId === 'core_impl')!;
    const integration = checkpoints.find((c) => c.checkpointId === 'integration')!;
    const exec = checkpoints.find((c) => c.checkpointId === 'execution')!;
    const testing = checkpoints.find((c) => c.checkpointId === 'testing_verification')!;

    expect(bp.status).toBe('VERIFIED');
    expect(bp.score).toBe(bp.maxScore);

    expect(core.status).toBe('PARTIAL'); // Found 2 source files
    expect(core.score).toBeGreaterThan(0);

    expect(integration.status).toBe('VERIFIED');
    expect(integration.score).toBe(integration.maxScore);

    expect(exec.status).toBe('VERIFIED');
    expect(exec.score).toBe(exec.maxScore);
    expect(exec.evidenceFiles).toContain('Hostel_allocate.java');

    expect(testing.status).toBe('VERIFIED');
    expect(testing.score).toBe(testing.maxScore);
    expect(testing.evidenceFiles).toContain('TestHostelAllocate.java');
  });
});
