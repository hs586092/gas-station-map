-- 경유 판매금액 컬럼 추가 (휘발유와 동일하게 가격 역산용)
ALTER TABLE sales_data ADD COLUMN IF NOT EXISTS diesel_amount NUMERIC(12,0);

COMMENT ON COLUMN sales_data.diesel_amount IS '경유 판매금액 (원, 할인포함)';
