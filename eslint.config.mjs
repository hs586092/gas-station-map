import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // dashboard_snapshot 테이블은 load-snapshot.ts 와 build-snapshot.ts 를 통해서만 접근한다.
  // 다른 경로에서 직접 조회하면 "헤더와 브리핑이 같은 시점의 같은 데이터를 본다"는 invariant 가 깨진다.
  // 2026-04-19 수치 불일치 사고 재발 방지.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "src/lib/dashboard/load-snapshot.ts",
      "src/lib/dashboard/build-snapshot.ts",
      // NOTE: [id] 폴더 대괄호는 minimatch 특수문자. 괄호 안 문자 중 하나를 매치하는 문자클래스로 처리된다.
      // "[id]" 를 문자 그대로 매치하려면 각 대괄호를 [[]/[]] 로 이스케이프해야 한다.
      "src/app/api/snapshot/[[]id[]]/route.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='dashboard_snapshot']",
          message:
            "dashboard_snapshot 테이블 직접 조회 금지. src/lib/dashboard/load-snapshot.ts 의 loadDashboardSnapshot() 을 사용하세요.",
        },
      ],
    },
  },
]);

export default eslintConfig;
